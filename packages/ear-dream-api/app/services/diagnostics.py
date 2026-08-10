"""/recognize 진단 로깅 — 요청·전처리·모델 원시 출력을 request_id 로 조인해 저장한다.

목적: 실사용 요청이 전부 rejected 로 나오는 문제의 원인 분석(ml-dev 진단의 입력).
아카이브(`var/archive/`)에는 좌표 원본이 이미 있으므로 여기에는 **요약 통계와 모델
softmax 전체**만 싣는다 — 좌표 원본은 request_id 로 조인한다.

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

⚠️ 이 모듈의 정규화 통계는 app/ml/preprocess.normalize_signer 의 scale 계산을
   **관측용으로만 재현**한다. 전처리 정본은 여전히 preprocess.py 한 곳이다 — 여기 값은
   학습 분포와의 비교용 진단 수치일 뿐, 추론 경로에 관여하지 않는다.
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
from app.ml.keypoint_layout import (
    L_SHOULDER,
    L_WRIST,
    LEFT_HAND,
    R_SHOULDER,
    R_WRIST,
    RIGHT_HAND,
)
from app.ml.model import get_model_state
from app.ml.preprocess import PreprocessOutput, normalize_signer, trim_rest_bounds, zero_z

# 클래스 인덱스 라벨링용. 정본은 체크포인트 class_labels 이지만, 로드 시 vocab.py 의
# sorted 규약과 일치를 강제(불일치 = 로드 거부)하므로 여기서는 동일한 매핑이다.
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

DIAGNOSTICS_SCHEMA = "recognize-diagnostics-v1"

# MediaPipe pose 원본 인덱스 (어깨·손목 visibility 통계용)
_MP_L_SHOULDER, _MP_R_SHOULDER = 11, 12


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


def _assembly_stats(request: RecognizeRequest, kp: np.ndarray) -> dict[str, Any]:
    """조립 결과 (T, 130, 3) + 원 요청 프레임으로 검출·배정 통계를 만든다."""
    frames = request.segment.frames
    t_total = len(frames)

    hands_n = np.array([len(f.hands) for f in frames], dtype=np.int64)
    hands_dist = {str(k): int((hands_n == k).sum()) for k in (0, 1, 2)}

    # 좌/우 슬롯 배정 경로: assembly._assign_hands 와 동일 조건 — 포즈 양 손목(xy)이
    # 조립 배열에 살아 있으면 기하 매칭, 아니면 handedness 라벨 fallback.
    lw_ok = ~np.isnan(kp[:, L_WRIST, :2]).any(axis=1)
    rw_ok = ~np.isnan(kp[:, R_WRIST, :2]).any(axis=1)
    wrists_ok = lw_ok & rw_ok
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
        "hand_slot_assignment": {
            "geometry_frames": int((wrists_ok & with_hands).sum()),
            "label_fallback_frames": int((~wrists_ok & with_hands).sum()),
        },
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


def _preprocess_stats(
    kp: np.ndarray, pp: PreprocessOutput, aspect_ratio: float, use_z: bool
) -> dict[str, Any]:
    """트리밍·보간 요약 + 정규화 직후 좌표 통계 (학습 분포 비교용 소수 요약).

    normalize_signer 의 scale(유효 프레임 중앙값 어깨 너비)을 관측용으로 재현한다.
    v2 등방 정규화와 동일하게 픽셀 비율 복원(x ← x×AR) **후** 좌표로 계산한다 —
    서빙 경로(preprocess_eval)가 실제로 쓰는 값과 같아야 진단 수치로 의미가 있다.
    use_z=False(z-off 모델)면 서빙과 동일하게 z 를 0 으로 고정한 좌표로 통계를 낸다 —
    hand_z 등 z 통계가 모델이 실제로 본 값(0)을 정직하게 기록해야 한다 (핸드오프 09 §3).
    """
    if not use_z:
        kp = zero_z(kp)
    start, end = trim_rest_bounds(kp)
    trimmed = kp[start:end]
    if trimmed.shape[0] == 0:
        trimmed = np.zeros((2, kp.shape[1], 3), dtype=np.float32)

    iso = trimmed.astype(np.float32).copy()
    iso[:, :, 0] *= np.float32(aspect_ratio)
    ls = iso[:, L_SHOULDER, :]
    rs = iso[:, R_SHOULDER, :]
    center = (ls + rs) / 2.0
    width = np.linalg.norm((ls - rs)[:, :2], axis=1)
    valid = ~np.isnan(center).any(axis=1) & ~np.isnan(width) & (width > 1e-6)
    used_fixed_fallback = not bool(valid.any())
    scale = 0.25 if used_fixed_fallback else float(np.nanmedian(width[valid]))

    norm = normalize_signer(trimmed, aspect_ratio=aspect_ratio)
    norm_width = np.linalg.norm((norm[:, L_SHOULDER, :2] - norm[:, R_SHOULDER, :2]), axis=1)
    hand_block = norm[:, LEFT_HAND + RIGHT_HAND, :]

    return {
        "trim": {
            "start_index": start,
            "end_index": end,
            "used_frame_count": pp.used_frame_count,
            "interpolated_frame_count": pp.interpolated_frame_count,
        },
        "normalization": {
            "aspect_ratio": _f(aspect_ratio),
            # 체크포인트 계약 — False 면 위 post_norm 의 z 통계는 zero_z 적용 후 값(=0)이다
            "use_z": use_z,
            "shoulder_width_scale": _f(scale),
            "shoulder_valid_frame_ratio": _f(valid.mean()) if valid.size else None,
            "used_fixed_fallback": used_fixed_fallback,
            "post_norm": {
                # 정규화 후 어깨 너비는 프레임별로 scale 나눔이라 중앙값≈1 이 정상
                "shoulder_width": _series_stats(norm_width),
                "left_wrist_y": _series_stats(norm[:, LEFT_HAND[0], 1]),
                "right_wrist_y": _series_stats(norm[:, RIGHT_HAND[0], 1]),
                "hand_x": _series_stats(hand_block[:, :, 0].ravel()),
                "hand_y": _series_stats(hand_block[:, :, 1].ravel()),
                "hand_z": _series_stats(hand_block[:, :, 2].ravel()),
            },
        },
    }


def _model_output(probs: np.ndarray) -> dict[str, Any]:
    """30 클래스 softmax 전체 — 라벨과 함께 내림차순."""
    order = np.argsort(probs)[::-1]
    softmax = [
        {
            "rank": rank + 1,
            "class_index": int(i),
            "id": CLASS_INDEX_TO_ENTRY[i].id,
            "label": CLASS_INDEX_TO_ENTRY[i].label,
            "prob": _f(probs[i]),
        }
        for rank, i in enumerate(order)
    ]
    p = np.clip(probs.astype(np.float64), 1e-12, 1.0)
    return {
        "softmax": softmax,
        "top1": {"label": softmax[0]["label"], "prob": softmax[0]["prob"]},
        "entropy": _f(-(p * np.log(p)).sum()),
    }


# ---------------------------------------------------------------- 공개 API
def build_recognize_diagnostics(
    request: RecognizeRequest,
    kp: np.ndarray,
    result: RecognitionResult,
    *,
    pp: PreprocessOutput | None,
    probs: np.ndarray | None,
    latency_ms: float | None = None,
) -> dict[str, Any]:
    """진단 레코드(dict)를 만든다. pp/probs 는 low_quality 로 추론을 건너뛰면 None."""
    cap = request.segment.capture
    aspect_ratio = cap.source_width / cap.source_height
    state = get_model_state()
    return {
        "schema": DIAGNOSTICS_SCHEMA,
        "created_at": datetime.now(UTC).isoformat(),
        "session_id": request.session_id,
        "request_id": request.request_id,
        "request": _request_summary(request),
        "assembly": _assembly_stats(request, kp),
        "preprocess": (
            _preprocess_stats(kp, pp, aspect_ratio, state.use_z) if pp is not None else None
        ),
        "model_output": _model_output(probs) if probs is not None else None,
        "response": {
            "status": result.status.value,
            "candidates": [c.model_dump() for c in result.candidates],
            "quality_issues": [i.value for i in result.quality_issues],
            # ⚠️ 임계·top_k 는 미확정 임시값 — 어떤 설정으로 판정했는지 레코드에 남긴다
            "reject_threshold": settings.reject_threshold,
            "top_k": settings.recognize_top_k,
            # temperature scaling (calibration.json) — conf 분포 비교 시 필수 맥락
            "temperature": _f(state.temperature),
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
            request, kp, result, pp=pp, probs=probs, latency_ms=latency_ms
        )
    except Exception:
        logger.exception("diagnostics build failed")
        return None
    return write_diagnostics_record(
        record,
        session_dirname=archive_info.session_dirname if archive_info else None,
        seq=archive_info.seq if archive_info else None,
    )
