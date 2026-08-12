"""/recognize 진단 로깅 — 요청·전처리·모델 원시 출력을 request_id 로 조인해 저장한다.

목적: 실사용 요청의 인식 실패 원인 분석(ml-dev 진단의 입력).
아카이브(`var/archive/`)에는 좌표 원본이 이미 있으므로 여기에는 **요약 통계와 모델
softmax 상위**만 싣는다 — 좌표 원본은 request_id 로 조인한다.

저장 경로 (아카이브와 같은 네이밍 규칙 — app/services/archive.py 참조):

    {api 패키지 루트}/{settings.diagnostics_dir}/{MMDD_HHMM}_{sess8}/{seq:03d}_{req8}_{status}[_{top1라벨}].json
    예: var/diagnostics/0810_1430_1576b87c/003_b2b7be10_recognized_꿈.json

진단은 응답 후 기록이므로 결과(status·top1 라벨)를 파일명에 싣는다 — ls 만으로 훑을 수
있게. 세션 폴더명과 seq 는 아카이브가 정한 값을 request.state 경유로 전달받아 재사용한다
(아카이브 파일과 `{seq:03d}_{req8}` 접두로 조인된다). 아카이브가 비활성이면 자체 계산한다.
(설정 diagnostics_enabled 로 on/off. var/ 는 .gitignore 대상)

기록 시점: /recognize 가 RecognitionResult 를 만든 모든 경로 (recognized / rejected /
low_quality). 503·422 는 결과가 없으므로 기록하지 않는다 (422 본문은 아카이브가 보관).

기록 실패는 인식 요청을 막지 않는다 (베스트 에포트 — archive 와 동일 원칙).

⚠️ 이 모듈의 정규화 통계는 app/ml/preprocess_spoter 의 결과를 **관측용으로만 요약**한다.
   전처리 정본은 여전히 preprocess_spoter.py 한 곳이다.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.core.config import settings
from app.core.logging import get_logger
from app.ml.assembly import AssemblyMeta
from app.ml.keypoint_layout import LEFT_HAND, RIGHT_HAND
from app.ml.model import get_model_state
from app.ml.preprocess_spoter import AR_TRAIN, TARGET_FPS, PreprocessOutput

# 클래스 인덱스 라벨링용. 정본은 release.json class_labels 이지만, 로드 시
# vocab300.json(CLASS_INDEX_TO_ENTRY)과 일치를 강제(불일치 = 로드 거부)하므로 동일 매핑이다.
from app.ml.vocab import CLASS_INDEX_TO_ENTRY
from app.schemas.recognition import RecognitionResult, RecognizeRequest

# 파일명 안전화·세션 폴더·순번 규칙을 아카이브와 공유한다 (같은 폴더명·seq 로 조인)
from app.services.archive import (
    ArchiveInfo,
    next_seq,
    resolve_session_dir,
    sanitize_component,
    short_id,
)

logger = get_logger("diagnostics")

# v3 (SPOTER-208 전환):
#   - assembly.hand_slot_assignment 은 assembly 모듈의 배정 메타(AssemblyMeta.summary())
#     그대로다 — 경로 분포(paths)·기하-라벨 불일치·단일손 슬롯 전환 횟수. (stash v2.6 포팅)
#   - preprocess 섹션이 spoter2_mp_xy_v1 계약으로 바뀌었다: trim/보간 없음 →
#     부위별 검출율·30fps 리샘플·정규화 후 범위 요약. v2 의 어깨 scale/hand_z 통계 제거.
#   - model_output.softmax 는 300 클래스 전체 대신 상위 10개만 싣는다 (파일 크기).
#   - (추가 필드, 2026-08-11) preprocess.ar_correction — AR 보정 배율 추적
#     (preprocess_spoter 모듈 docstring). 필드 추가만이라 스키마 버전은 유지한다.
#   - (추가 필드, 2026-08-12) 라이브 도메인 갭 개입 2종 추적:
#     preprocess.ar_correction.y_scale — 원근 갭 y 보정 배율(settings.live_y_scale),
#     response.debias_alpha / debias_loaded — 로짓 편향 제거 적용 여부.
#     ⚠️ debias 적용 레코드부터 candidates·softmax_top 의 confidence 정의가
#     **편향 제거 후 분포**로 바뀐다 (app/ml/model docstring) — 과거 레코드와 conf
#     분포를 비교할 때 debias_alpha 로 구분할 것. 필드 추가만이라 버전은 유지한다.
DIAGNOSTICS_SCHEMA = "recognize-diagnostics-v3"

# 어깨 visibility 통계용 MediaPipe pose 원본 인덱스
_MP_L_SHOULDER, _MP_R_SHOULDER = 11, 12

# softmax 기록 상위 개수 (전체 300개는 레코드만 불린다 — entropy 로 분포 요약)
_SOFTMAX_TOP_N = 10


def _f(value: float | np.floating | None) -> float | None:
    """유한한 float 만 남긴다 — NaN/inf 는 JSON 에 싣지 않고 None 으로 둔다."""
    if value is None:
        return None
    v = float(value)
    return v if math.isfinite(v) else None


def _series_stats(values: np.ndarray) -> dict[str, float | None] | None:
    """1-D 배열의 min/mean/max 요약. 유한값이 없으면 None."""
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    return {
        "min": _f(finite.min()),
        "mean": _f(finite.mean()),
        "max": _f(finite.max()),
    }


# ---------------------------------------------------------------- 섹션 빌더
def _request_summary(request: RecognizeRequest) -> dict[str, Any]:
    seg = request.segment
    cap = seg.capture
    n = len(seg.frames)
    span_ms = seg.frames[-1].t_ms - seg.frames[0].t_ms if n >= 2 else 0.0
    return {
        "frame_count": n,
        "duration_ms": _f(span_ms),
        "approx_fps": _f((n - 1) / span_ms * 1000.0) if span_ms > 0 else None,
        "press_start_ms": _f(seg.press_start_ms),
        "press_end_ms": _f(seg.press_end_ms),
        "boundary_mode": seg.boundary_mode.value,
        "source_width": cap.source_width,
        "source_height": cap.source_height,
        "aspect_ratio": _f(cap.source_width / cap.source_height),
        "facing_mode": cap.facing_mode,
        "preview_mirrored": cap.preview_mirrored,
        "delegate": cap.delegate,
        "landmarker_model_versions": cap.landmarker_model_versions,
        "client_version": cap.client_version,
    }


def _assembly_stats(
    request: RecognizeRequest, kp: np.ndarray, meta: AssemblyMeta
) -> dict[str, Any]:
    """조립 결과 (T, 130, 3) + 원 요청 프레임으로 검출·배정 통계를 만든다.

    배정 경로 통계는 assembly 가 조립하면서 만든 메타(AssemblyMeta)를 그대로 싣는다 —
    여기서 배정 로직을 재계산하지 않는다 (재계산은 assembly 와의 드리프트 위험).
    """
    frames = request.segment.frames
    t_total = len(frames)

    hands_n = np.array([len(f.hands) for f in frames], dtype=np.int64)
    hands_dist = {str(k): int((hands_n == k).sum()) for k in (0, 1, 2)}
    with_hands = hands_n > 0

    left_slot = ~np.isnan(kp[:, LEFT_HAND, :]).all(axis=(1, 2))
    right_slot = ~np.isnan(kp[:, RIGHT_HAND, :]).all(axis=(1, 2))

    # 어깨 visibility (pose 원본 기준 — visibility 임계 적용 전 값)
    shoulder_vis: list[float] = []
    left_vis: list[float] = []
    right_vis: list[float] = []
    for f in frames:
        if f.pose is None:
            continue
        lv, rv = f.pose.visibility[_MP_L_SHOULDER], f.pose.visibility[_MP_R_SHOULDER]
        left_vis.append(lv)
        right_vis.append(rv)
        shoulder_vis.extend((lv, rv))

    pose_null = sum(1 for f in frames if f.pose is None)
    face_detected = sum(1 for f in frames if f.face is not None)

    return {
        "hands_per_frame": hands_dist,
        "hand_present_ratio": _f(with_hands.mean()) if t_total else None,
        "hand_slot_assignment": meta.summary(),
        "slot_filled_frames": {"left": int(left_slot.sum()), "right": int(right_slot.sum())},
        "face_detected_ratio": _f(face_detected / t_total) if t_total else None,
        "pose_null_ratio": _f(pose_null / t_total) if t_total else None,
        "shoulder_visibility": {
            "mean": _f(np.mean(shoulder_vis)) if shoulder_vis else None,
            "min": _f(np.min(shoulder_vis)) if shoulder_vis else None,
            "left_mean": _f(np.mean(left_vis)) if left_vis else None,
            "right_mean": _f(np.mean(right_vis)) if right_vis else None,
        },
    }


def _preprocess_stats(request: RecognizeRequest, pp: PreprocessOutput) -> dict[str, Any]:
    """spoter2_mp_xy_v1 전처리 결과 요약 — 리샘플·부위 검출율·정규화 후 범위.

    학습 분포와의 비교용 관측 수치다: pose(global)는 어깨 기준 정규화라 대체로 수 단위,
    hands/face(local)는 정상 검출 시 [-1, 1] 범위가 기대값이다 (계약 문서 §15.2).
    """
    x = pp.x  # (T, 208)
    pose_block = x[:, 0:50]
    hands_block = x[:, 50:134]
    face_block = x[:, 134:208]
    part_mask = pp.part_mask.astype(bool)

    def _detected_stats(block: np.ndarray, cols: list[int]) -> dict[str, Any] | None:
        """해당 부위가 검출된 프레임의 값만 요약한다 (0-채움 프레임 제외)."""
        rows = part_mask[:, cols].any(axis=1)
        if not rows.any():
            return None
        return _series_stats(block[rows].ravel())

    return {
        # 입력측 기하 보정 추적 — 아카이브 분석 시 적용 여부·배율을 레코드만으로 판별한다
        # (x_scale = source_aspect / AR_TRAIN, 16:9 입력이면 1.0 = 항등.
        #  y_scale 은 settings.live_y_scale 고정 상수 — 1.0 이면 보정 끔)
        "ar_correction": {
            "source_aspect": _f(pp.source_aspect),
            "ar_train": _f(AR_TRAIN),
            "x_scale": _f(pp.x_scale),
            "y_scale": _f(pp.y_scale),
        },
        "resample": {
            "source_frame_count": pp.source_frame_count,
            "resampled_frame_count": pp.resampled_frame_count,
            "model_frame_count": pp.model_frame_count,
            "target_fps": TARGET_FPS,  # ⚠️ 임시 정책 (preprocess_spoter docstring)
            "uniform_sampled": pp.resampled_frame_count > pp.model_frame_count,
        },
        "part_detection_rates": {name: _f(rate) for name, rate in pp.part_detection_rates.items()},
        "post_norm": {
            # PARTS 인덱스: 0=pose, 1=right_hand, 2=left_hand, 3=face
            "pose": _detected_stats(pose_block, [0]),
            "hands": _detected_stats(hands_block, [1, 2]),
            "face": _detected_stats(face_block, [3]),
        },
    }


def _model_output(probs: np.ndarray) -> dict[str, Any]:
    """softmax 상위 _SOFTMAX_TOP_N — 라벨과 함께 내림차순. entropy 는 전체 분포 기준."""
    order = np.argsort(probs)[::-1]
    softmax = [
        {
            "rank": rank + 1,
            "class_index": int(i),
            "id": CLASS_INDEX_TO_ENTRY[i].id,
            "label": CLASS_INDEX_TO_ENTRY[i].label,
            "prob": _f(probs[i]),
        }
        for rank, i in enumerate(order[:_SOFTMAX_TOP_N])
    ]
    p = np.clip(probs.astype(np.float64), 1e-12, 1.0)
    return {
        "softmax_top": softmax,
        "num_classes": int(probs.shape[0]),
        "top1": {"label": softmax[0]["label"], "prob": softmax[0]["prob"]},
        "entropy": _f(-(p * np.log(p)).sum()),
    }


# ---------------------------------------------------------------- 공개 API
def build_recognize_diagnostics(
    request: RecognizeRequest,
    kp: np.ndarray,
    result: RecognitionResult,
    *,
    assembly_meta: AssemblyMeta,
    pp: PreprocessOutput | None,
    probs: np.ndarray | None,
    latency_ms: float | None = None,
) -> dict[str, Any]:
    """진단 레코드(dict)를 만든다. pp/probs 는 low_quality 로 추론을 건너뛰면 None.

    assembly_meta 는 assemble_frames 가 kp 와 함께 돌려준 배정 메타다 — 진단은 이를
    집계만 한다.
    """
    state = get_model_state()
    return {
        "schema": DIAGNOSTICS_SCHEMA,
        "created_at": datetime.now(UTC).isoformat(),
        "session_id": request.session_id,
        "request_id": request.request_id,
        "request": _request_summary(request),
        "assembly": _assembly_stats(request, kp, assembly_meta),
        "preprocess": _preprocess_stats(request, pp) if pp is not None else None,
        "model_output": _model_output(probs) if probs is not None else None,
        "response": {
            "status": result.status.value,
            "candidates": [c.model_dump() for c in result.candidates],
            "quality_issues": [i.value for i in result.quality_issues],
            # ⚠️ 임계·top_k 는 미확정 임시값 — 어떤 설정으로 판정했는지 레코드에 남긴다
            "reject_threshold": state.reject_threshold,
            "top_k": settings.recognize_top_k,
            # temperature scaling (release.json serving) — conf 분포 비교 시 필수 맥락
            "temperature": _f(state.temperature),
            # 로짓 편향 제거 (app/ml/model docstring) — alpha>0 && loaded 면 이 레코드의
            # candidates·softmax_top confidence 는 **편향 제거 후 분포** 기준이다
            "debias_alpha": _f(state.debias_alpha),
            "debias_loaded": state.debias_bias is not None,
            "model_version": result.model_version,
            "vocab_version": result.vocab_version,
            "latency_ms": _f(latency_ms),
        },
    }


def write_diagnostics_record(
    record: dict[str, Any],
    *,
    subdir: str | None = None,
    session_dirname: str | None = None,
    seq: int | None = None,
) -> Path | None:
    """레코드를 저장하고 경로를 돌려준다. 어떤 예외도 밖으로 던지지 않는다.

    - subdir: diagnostics_dir 아래 추가 디렉토리 (재생 분석은 "replay" 를 쓴다 —
      라이브 기록과 섞이지 않게)
    - session_dirname/seq: 아카이브가 이미 정한 세션 폴더명·순번 — 아카이브 파일과
      `{seq:03d}_{req8}` 접두로 조인되게 한다. None 이면 자체 계산한다.

    파일명: {seq:03d}_{req8}_{status}[_{top1라벨}].json — 응답 후 기록이므로 결과를
    이름에 싣는다 (예: 003_b2b7be10_recognized_꿈.json).
    """
    try:
        base = settings.package_root / settings.diagnostics_dir
        if subdir:
            base = base / sanitize_component(subdir, "extra")
        session_id = str(record.get("session_id", "unknown"))
        target_dir = (
            base / session_dirname if session_dirname else resolve_session_dir(base, session_id)
        )
        target_dir.mkdir(parents=True, exist_ok=True)
        if seq is None:
            seq = next_seq(target_dir, "*.json")

        parts = [f"{seq:03d}", short_id(str(record.get("request_id", "unknown")), "unknown")]
        response = record.get("response") or {}
        if response.get("status"):
            parts.append(sanitize_component(str(response["status"]), "status"))
        top1 = ((record.get("model_output") or {}).get("top1") or {}).get("label")
        if top1:  # low_quality 등 모델 출력이 없으면 생략
            parts.append(sanitize_component(str(top1), "top1"))

        target = target_dir / ("_".join(parts) + ".json")
        target.write_text(json.dumps(record, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return target
    except Exception:
        logger.exception("diagnostics write failed")
        return None


def record_recognize_diagnostics(
    request: RecognizeRequest,
    kp: np.ndarray,
    result: RecognitionResult,
    *,
    assembly_meta: AssemblyMeta,
    pp: PreprocessOutput | None,
    probs: np.ndarray | None,
    latency_ms: float | None = None,
    archive_info: ArchiveInfo | None = None,
) -> Path | None:
    """빌드+저장 원스톱 (라우트용). 비활성이거나 실패하면 None — 요청 처리를 막지 않는다.

    archive_info 가 있으면 아카이브와 같은 세션 폴더명·seq 를 써서 파일명으로 조인된다.
    """
    if not settings.diagnostics_enabled:
        return None
    try:
        record = build_recognize_diagnostics(
            request,
            kp,
            result,
            assembly_meta=assembly_meta,
            pp=pp,
            probs=probs,
            latency_ms=latency_ms,
        )
    except Exception:
        logger.exception("diagnostics build failed")
        return None
    return write_diagnostics_record(
        record,
        session_dirname=archive_info.session_dirname if archive_info else None,
        seq=archive_info.seq if archive_info else None,
    )
