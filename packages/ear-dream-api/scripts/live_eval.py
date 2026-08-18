"""라벨된 라이브 평가 — SPOTER-208 300단어 서빙 파이프라인 베이스라인 측정.

입력: Ear-Dream-Model 레포의 frames_tasks 캐시 (영상 → Python mediapipe tasks API 로
1회 추출해 둔 서버 요청 프레임 형식 JSON.gz — 이후 가설 반복의 고정 입력).
라벨: 같은 디렉토리의 labels.csv (clip_id,word,signer_id — 파일명은 NFD 이므로 NFC
정규화 후 대조). vocab300 에 있는 단어의 클립만 평가한다.

파이프라인은 서빙과 동일 모듈을 그대로 태운다 (train/serve skew 방지 — 설계 결정 1):
  캐시 프레임 → LandmarkFrame 파싱 → assemble_frames → preprocess_spoter(source_aspect
  실측 + y_scale) → TorchScript CPU → logits ÷ temperature(release.json) → softmax
  → 로짓 편향 제거(모델 상태) → top-k.

⚠️ 서빙 채택된 개입(y 보정·편향 제거, 2026-08-12)은 이제 **서빙 모듈 안**에 있다 —
   preprocess_spoter 의 y_scale 인자와 ModelState.debias_* 필드. 이 러너의
   --y-scale/--debias-alpha/--debias 는 그 서빙 값을 **오버라이드**하는 옵션이다
   (기본 = 서빙 설정 그대로. 러너가 따로 한 번 더 적용하는 이중 적용은 없다).
   실험 당시의 러너 내 구현(y_scale_bundle·후처리 debias)은 서빙 포팅 후 제거됐다.

사용 (api 패키지 루트에서):
    uv run python scripts/live_eval.py                 # AR 보정 ON (현재 서빙 상태)
    uv run python scripts/live_eval.py --no-ar         # AR 보정 OFF (aspect=16/9 강제)
    uv run python scripts/live_eval.py --json out.json # 클립별 상세 JSON 저장
    uv run python scripts/live_eval.py --frames-dir .../frames_holistic --holistic
        # 추출기 통일 실험: 학습과 동일한 Holistic(legacy) 추출 캐시.
        # Holistic 은 손 좌/우 슬롯을 모델이 직접 배정하므로 assemble_frames 를
        # **우회**하고 캐시 슬롯을 kp130 의 LEFT_HAND/RIGHT_HAND 블록에 직접 넣는다 —
        # 학습 데이터(300단어 H5)의 손 슬롯 소스와 동일한 방식이다.

⚠️ 이 데이터는 **평가 전용**이다 — 학습에 쓰지 않는다.
⚠️ 추출은 라이브(브라우저 tasks-vision·GPU)와 완전히 같지 않다 — Python tasks API·CPU
   delegate 로 근사한 것이다. 캐시의 extractor 메타에 조건이 기록돼 있다.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import numpy as np

from app.core.config import settings
from app.ml.assembly import assemble_frames
from app.ml.keypoint_layout import LEFT_HAND, N_KP, RIGHT_HAND
from app.ml.model import get_model_state
from app.ml.preprocess_spoter import AR_TRAIN, preprocess_spoter
from app.schemas.landmark import LandmarkFrame

# 모델 레포는 이 레포의 형제 디렉토리에 있다 (build_sign_sequences.py 와 같은 규약).
# 다른 위치면 --eval-dir 로 넘긴다 — 절대경로를 박지 않는다.
REPO_ROOT = API_ROOT.parents[1]
DEFAULT_EVAL_DIR = REPO_ROOT.parent / "Ear-Dream-Model/data/live_eval"
TOP_K = 4

# [T,208] 피처의 부위별 열 구간 (preprocess_spoter 의 specs 순서와 동일)
PART_SLICES = {
    "pose": slice(0, 50),
    "right_hand": slice(50, 92),
    "left_hand": slice(92, 134),
    "face": slice(134, 208),
}


def fill_series(arr: np.ndarray, mode: str) -> np.ndarray:
    """(T, ...) 시계열의 결측 프레임(해당 프레임 전체 NaN)을 채운다.

    결측 손 OOD 가설 실험용 — 학습 데이터는 손 검출률 99.4~99.5% 라 결측이 사실상
    없으므로, 라이브의 결측을 채우는 것은 서빙 입력을 학습 분포로 사영하는 조작이다
    (AR 보정과 같은 논리). 전 프레임 결측이면 그대로 둔다 (0-채움 유지).

    mode:
      hold   — 직전 검출값 유지 (앞쪽 결측은 최초 검출값 backward-fill)
      interp — 검출 구간 사이 원시 좌표 선형 보간, 양 끝은 최근접값 hold
    """
    T = arr.shape[0]
    flat = arr.reshape(T, -1)
    detected = ~np.isnan(flat).any(axis=1)
    if not detected.any() or detected.all():
        return arr
    det_idx = np.flatnonzero(detected)
    if mode == "hold":
        # 직전 검출 인덱스 (없으면 최초 검출 인덱스)
        prev = np.maximum.accumulate(np.where(detected, np.arange(T), -1))
        prev = np.where(prev < 0, det_idx[0], prev)
        return arr[prev]
    if mode == "interp":
        out = flat.copy()
        t = np.arange(T, dtype=np.float64)
        for j in range(flat.shape[1]):
            out[:, j] = np.interp(t, det_idx.astype(np.float64), flat[det_idx, j])
        return out.reshape(arr.shape)
    raise ValueError(f"unknown fill mode: {mode}")


def apply_fill(
    frames: list[LandmarkFrame], kp130: np.ndarray, mode: str, parts: str
) -> tuple[list[LandmarkFrame], np.ndarray]:
    """결측 채움을 손 슬롯(kp130)과 — parts=='all' 이면 pose/face(frames)에도 — 적용."""
    kp = kp130.copy()
    for slot in (LEFT_HAND, RIGHT_HAND):
        kp[:, slot] = fill_series(kp[:, slot], mode)
    if parts != "all":
        return frames, kp

    T = len(frames)
    pose_arr = np.full((T, 33, 4), np.nan)  # xyz + visibility
    face_arr = np.full((T, 478, 3), np.nan)
    for t, fr in enumerate(frames):
        if fr.pose is not None:
            pose_arr[t, :, :3] = fr.pose.landmarks
            pose_arr[t, :, 3] = fr.pose.visibility
        if fr.face is not None and len(fr.face.landmarks) == 478:
            face_arr[t] = fr.face.landmarks
    pose_arr = fill_series(pose_arr, mode)
    face_arr = fill_series(face_arr, mode)
    out_frames: list[LandmarkFrame] = []
    for t, fr in enumerate(frames):
        pose = fr.pose
        if pose is None and not np.isnan(pose_arr[t]).any():
            pose = {
                "landmarks": pose_arr[t, :, :3].tolist(),
                "visibility": pose_arr[t, :, 3].tolist(),
            }
        face = fr.face
        if face is None and not np.isnan(face_arr[t]).any():
            face = {"landmarks": face_arr[t].tolist()}
        if pose is fr.pose and face is fr.face:
            out_frames.append(fr)
        else:
            out_frames.append(
                LandmarkFrame.model_validate(
                    {"t_ms": fr.t_ms, "hands": [], "face": face, "pose": pose}
                )
            )
    return out_frames, kp


# ================================================================ 변형 번들
# 가설 배치 2 (TTA·기하·시간축)용 — 손 슬롯 배정(assembly) **이후**의 클립을
# numpy 배열 묶음으로 다뤄 변형을 합성한다. 결측은 프레임 단위 NaN 유지.


@dataclass
class ClipBundle:
    t_ms: np.ndarray  # (T,)
    pose: np.ndarray  # (T, 33, 4) xyz + visibility, 프레임 결측이면 NaN
    face: np.ndarray  # (T, 478, 3)
    kp130: np.ndarray  # (T, 130, 3) — 손 슬롯만 소비된다


def bundle_from(frames: list[LandmarkFrame], kp130: np.ndarray) -> ClipBundle:
    T = len(frames)
    pose = np.full((T, 33, 4), np.nan)
    face = np.full((T, 478, 3), np.nan)
    for t, fr in enumerate(frames):
        if fr.pose is not None:
            pose[t, :, :3] = fr.pose.landmarks
            pose[t, :, 3] = fr.pose.visibility
        if fr.face is not None and len(fr.face.landmarks) == 478:
            face[t] = fr.face.landmarks
    return ClipBundle(
        t_ms=np.asarray([fr.t_ms for fr in frames], dtype=np.float64),
        pose=pose,
        face=face,
        kp130=kp130.copy(),
    )


def frames_from_bundle(b: ClipBundle) -> tuple[list[LandmarkFrame], np.ndarray]:
    frames = []
    for t in range(len(b.t_ms)):
        pose = None
        if not np.isnan(b.pose[t]).any():
            pose = {
                "landmarks": b.pose[t, :, :3].tolist(),
                "visibility": b.pose[t, :, 3].tolist(),
            }
        face = None
        if not np.isnan(b.face[t]).any():
            face = {"landmarks": b.face[t].tolist()}
        frames.append(
            LandmarkFrame.model_validate(
                {"t_ms": float(b.t_ms[t]), "hands": [], "face": face, "pose": pose}
            )
        )
    return frames, b.kp130


def _nan_moving_average(arr: np.ndarray, win: int) -> np.ndarray:
    """(T, ...) 시계열의 결측 인지 이동평균 — 검출 프레임끼리만 평균, 결측은 유지."""
    T = arr.shape[0]
    flat = arr.reshape(T, -1)
    detected = ~np.isnan(flat).any(axis=1)
    out = flat.copy()
    half = win // 2
    for t in np.flatnonzero(detected):
        lo, hi = max(0, t - half), min(T, t + half + 1)
        idx = [i for i in range(lo, hi) if detected[i]]
        out[t] = flat[idx].mean(axis=0)
    return out.reshape(arr.shape)


def smooth_bundle(b: ClipBundle, win: int) -> ClipBundle:
    """시간축 스무딩 — Holistic(학습)의 추적 스무딩 vs 분리 3모델(라이브)의 지터 갭.

    좌표(xyz)만 스무딩하고 visibility 는 원본 유지. 16/9 입력 항등성: 항등이 아니다
    (스튜디오 입력도 스무딩된다) — 단 학습 추출기가 이미 smooth_landmarks=True 라
    스튜디오 좌표는 저지터라서 이동평균의 변화량이 작다는 논리적 근거는 있다.
    """
    out = ClipBundle(b.t_ms.copy(), b.pose.copy(), b.face.copy(), b.kp130.copy())
    out.pose[:, :, :3] = _nan_moving_average(b.pose[:, :, :3], win)
    out.face = _nan_moving_average(b.face, win)
    for slot in (LEFT_HAND, RIGHT_HAND):
        out.kp130[:, slot] = _nan_moving_average(b.kp130[:, slot], win)
    return out


def resample_interp_bundle(b: ClipBundle, fps: float = 30.0) -> ClipBundle:
    """시간축 리샘플을 최근접 선택 대신 **좌표 선형 보간**으로 수행한 변형.

    30fps 그리드 시각의 좌표를 이웃 두 프레임에서 보간한다 (양쪽 검출 시).
    한쪽만 검출이면 최근접 프레임 값, 양쪽 결측이면 결측 유지 — 결측 채움(기각됨)과
    구분되는 시간축 정책 실험이다. 결과 t_ms 가 정확히 그리드라 preprocess 의
    최근접 리샘플은 항등이 된다. 30fps 등간격 입력(스튜디오)에서는 그리드가 원본과
    일치해 **항등에 수렴**한다.
    """
    t = b.t_ms
    if len(t) <= 1:
        return b
    step = 1000.0 / fps
    n_out = int(np.floor((t[-1] - t[0]) / step + 1e-6)) + 1
    grid = t[0] + np.arange(n_out) * step
    pos = np.clip(np.searchsorted(t, grid), 1, len(t) - 1)
    left, right = pos - 1, pos
    denom = np.maximum(t[right] - t[left], 1e-9)
    w = np.clip((grid - t[left]) / denom, 0.0, 1.0)  # (N,)
    nearest = np.where(w > 0.5, right, left)

    def interp_series(arr: np.ndarray) -> np.ndarray:
        T = arr.shape[0]
        flat = arr.reshape(T, -1)
        det = ~np.isnan(flat).any(axis=1)
        out = np.full((n_out, flat.shape[1]), np.nan)
        both = det[left] & det[right]
        ww = w[both][:, None]
        out[both] = (1 - ww) * flat[left[both]] + ww * flat[right[both]]
        only = ~both & det[nearest]
        out[only] = flat[nearest[only]]
        return out.reshape((n_out,) + arr.shape[1:])

    # kp130 은 행 전체가 아니라 **손 슬롯 단위**로 보간한다 — pose 블록의 visibility
    # 마스킹 NaN 이 행 단위 결측 판정을 오염시키면 손이 전멸한다 (preprocess 는 kp130
    # 에서 손 슬롯만 읽으므로 나머지 블록은 NaN 으로 둬도 된다).
    new_kp = np.full((n_out, b.kp130.shape[1], 3), np.nan, dtype=np.float32)
    for slot in (LEFT_HAND, RIGHT_HAND):
        new_kp[:, slot] = interp_series(b.kp130[:, slot]).astype(np.float32)
    return ClipBundle(
        t_ms=grid,
        pose=interp_series(b.pose),
        face=interp_series(b.face),
        kp130=new_kp,
    )


def tta_variants(b: ClipBundle, mode: str | None) -> list[tuple[ClipBundle, float]]:
    """TTA 변형 목록 [(bundle, AR 배율)]. 첫 원소는 항상 항등(진단 기준)."""
    ar_mults = [1.0, 0.90, 0.95, 1.05, 1.10]
    T = len(b.t_ms)

    def crop(lo_frac: float, hi_frac: float) -> ClipBundle:
        lo, hi = int(T * lo_frac), max(int(T * hi_frac), int(T * lo_frac) + 2)
        return ClipBundle(b.t_ms[lo:hi], b.pose[lo:hi], b.face[lo:hi], b.kp130[lo:hi])

    crops = [(0.0, 1.0), (0.1, 1.0), (0.0, 0.9)]
    if mode is None:
        return [(b, 1.0)]
    if mode == "ar":
        return [(b, m) for m in ar_mults]
    if mode == "time":
        return [(crop(lo, hi), 1.0) for lo, hi in crops]
    if mode == "both":
        return [(crop(lo, hi), m) for lo, hi in crops for m in ar_mults]
    raise ValueError(f"unknown tta mode: {mode}")


# MediaPipe pose 0~24 의 좌우 대칭 쌍 (미러링 검증용 인덱스 교환)
POSE_LR_PAIRS = [
    (1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14),
    (15, 16), (17, 18), (19, 20), (21, 22), (23, 24),
]  # fmt: skip


def mirror_cache_data(data: dict, *, holistic: bool) -> dict:
    """미러링 가설 검증 — 캐시 좌표를 좌우 반전한 사본을 돌려준다.

    x → -x (정규화가 평행이동 불변이라 1-x 와 등가이고, AR 보정은 양수 배율이라
    부호 반전과 교환 가능 — 로드 시점 반전으로 충분하다). 동시에:
      - 손: left/right 슬롯(holistic) 또는 handedness 라벨(tasks) 교환
      - pose: 좌우 대칭 인덱스 쌍 교환 (0~24 만 — 25~32 하체는 피처에 안 쓰인다)
      - face: x 부호만 반전. ⚠️ 근사 — 478 메쉬의 좌우 인덱스 순열은 적용하지 않았다.
        face 는 bbox local 정규화라 대략적 대칭 형상은 보존되지만 엄밀한 미러가 아니다.
        점수가 뛰면 반전 영상 재추출로 재검증할 것.
    """
    import copy

    out = copy.deepcopy(data)
    for fr in out["frames"]:
        if fr.get("pose") is not None:
            # holistic 캐시는 33×[x,y,z,vis] 리스트, tasks 캐시는
            # {"landmarks": 33×3, "visibility": 33} dict — 양쪽 처리
            if holistic:
                for p in fr["pose"]:
                    p[0] = -p[0]
                for a, b in POSE_LR_PAIRS:
                    fr["pose"][a], fr["pose"][b] = fr["pose"][b], fr["pose"][a]
            else:
                lms, vis = fr["pose"]["landmarks"], fr["pose"]["visibility"]
                for p in lms:
                    p[0] = -p[0]
                for a, b in POSE_LR_PAIRS:
                    lms[a], lms[b] = lms[b], lms[a]
                    vis[a], vis[b] = vis[b], vis[a]
        if fr.get("face") is not None:
            face = fr["face"]["landmarks"] if not holistic else fr["face"]
            for p in face:
                p[0] = -p[0]
        if holistic:
            for key in ("left_hand", "right_hand"):
                if fr.get(key) is not None:
                    for p in fr[key]:
                        p[0] = -p[0]
            fr["left_hand"], fr["right_hand"] = fr["right_hand"], fr["left_hand"]
        else:
            for hand in fr["hands"]:
                for p in hand["landmarks"]:
                    p[0] = -p[0]
                hand["handedness_label"] = (
                    "Right" if hand["handedness_label"].lower() == "left" else "Left"
                )
    return out


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def load_labels(eval_dir: Path) -> dict[str, dict[str, str]]:
    """clip_id(NFC) → {word(NFC), signer_id}."""
    import csv

    out: dict[str, dict[str, str]] = {}
    with (eval_dir / "labels.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[nfc(row["clip_id"])] = {
                "word": nfc(row["word"]),
                "signer_id": row["signer_id"],
            }
    return out


def load_holistic(data: dict) -> tuple[list[LandmarkFrame], np.ndarray]:
    """Holistic 캐시 → (LandmarkFrame 리스트, kp130).

    Holistic 은 left/right 손 슬롯을 추출기가 직접 배정하므로 assemble_frames 를
    우회한다: 캐시 슬롯 좌표를 kp130 의 LEFT_HAND/RIGHT_HAND 블록에 그대로 넣는다
    (미검출 슬롯은 NaN 유지 → preprocess 가 0-채움 + part_mask 0 처리).
    preprocess_spoter 는 kp130 에서 **손 블록만** 읽으므로 pose/face 블록은 채우지
    않아도 된다 — pose(25점 원본)/face 는 LandmarkFrame 에서 직접 읽는다.
    LandmarkFrame.hands 는 비워 둔다 (holistic 모드에서는 참조되지 않는다).
    """
    raw = data["frames"]
    kp130 = np.full((len(raw), N_KP, 3), np.nan, dtype=np.float32)
    frames: list[LandmarkFrame] = []
    for t, fr in enumerate(raw):
        pose = None
        if fr.get("pose") is not None:
            pose = {
                "landmarks": [p[:3] for p in fr["pose"]],
                "visibility": [p[3] for p in fr["pose"]],
            }
        face = {"landmarks": fr["face"]} if fr.get("face") is not None else None
        frames.append(
            LandmarkFrame.model_validate(
                {"t_ms": fr["t_ms"], "hands": [], "face": face, "pose": pose}
            )
        )
        if fr.get("left_hand") is not None:
            kp130[t, LEFT_HAND] = np.asarray(fr["left_hand"], dtype=np.float32)
        if fr.get("right_hand") is not None:
            kp130[t, RIGHT_HAND] = np.asarray(fr["right_hand"], dtype=np.float32)
    return frames, kp130


def eval_clip(
    cache_path: Path,
    label: str,
    *,
    apply_ar: bool,
    holistic: bool,
    state,
    y_scale: float,
    ablate: tuple[str, ...] = (),
    mirror: bool = False,
    fill: str | None = None,
    fill_parts: str = "hands",
    smooth: int = 0,
    resample_interp: bool = False,
    tta: str | None = None,
    coral: dict | None = None,
    hand_prior: tuple[np.ndarray, float, float] | None = None,
    trim_margin: int | None = None,
    proto: tuple[np.ndarray, np.ndarray, int, float] | None = None,
    prior: np.ndarray | None = None,
) -> dict[str, Any]:
    """클립 하나 평가. y_scale 은 preprocess_spoter 로 그대로 전달된다 (서빙과 동일
    경로 — 이중 적용 없음). 편향 제거는 state.debias_* 가 predict_probs 안에서 처리한다
    (TTA 시 softmax 평균은 **편향 제거 후** 분포의 평균이 된다 — 실험 당시의
    평균-후-제거 순서와 다르다)."""
    with gzip.open(cache_path, "rt", encoding="utf-8") as f:
        data = json.load(f)

    if mirror:
        data = mirror_cache_data(data, holistic=holistic)

    if holistic:
        frames, kp = load_holistic(data)
        assembly_summary = None
    else:
        frames = [LandmarkFrame.model_validate(fr) for fr in data["frames"]]
        kp, assembly_meta = assemble_frames(frames, settings.pose_visibility_threshold)
        assembly_summary = assembly_meta.summary()

    source_aspect = (
        float(data["source_width"]) / float(data["source_height"])
        if apply_ar
        else AR_TRAIN  # AR 보정 OFF = 배율 1.0 (좌표 원본 그대로)
    )
    if fill is not None:
        # 결측 채움은 30fps 리샘플 이전의 원시 좌표에 적용한다 (fill_series docstring).
        # 손 슬롯 배정(assembly) 이후에 적용하므로 배정 로직에는 영향이 없다.
        frames, kp = apply_fill(frames, kp, fill, fill_parts)

    if trim_margin is not None:
        # 손 없는 리드/테일 트리밍 (배치 3) — 어떤 손도 검출 안 된 선행·후행 구간을
        # 첫/마지막 손 검출 ±margin 프레임까지로 자른다. B4(±100ms, live_eval 영상)와
        # 다른 조작: 여기는 프레임 마진이고 phone_sessions 의 긴 리드(40~50%)가 표적이다.
        det = ~(np.isnan(kp[:, LEFT_HAND[0], 0]) & np.isnan(kp[:, RIGHT_HAND[0], 0]))
        idx = np.flatnonzero(det)
        if len(idx):
            lo = max(int(idx[0]) - trim_margin, 0)
            hi = min(int(idx[-1]) + trim_margin, len(frames) - 1)
            frames, kp = frames[lo : hi + 1], kp[lo : hi + 1]

    # ---- 변형 파이프라인 (배치 2) — 전부 손 슬롯 배정 이후, 전처리 이전에 합성
    # (y 보정은 여기가 아니라 preprocess_spoter 안이다 — 서빙 채택 후 이동)
    bundle = None
    if smooth or resample_interp or tta:
        bundle = bundle_from(frames, kp)
        if smooth:
            bundle = smooth_bundle(bundle, smooth)
        if resample_interp:
            bundle = resample_interp_bundle(bundle)

    def run_once(fr, kpv, aspect) -> tuple[np.ndarray, np.ndarray | None, Any]:
        pp = preprocess_spoter(fr, kpv, aspect, y_scale=y_scale)
        x = pp.x
        if ablate:
            # 부위 절제 — 해당 부위 열 0-채움 (학습 결측 표현과 동일 = in-distribution)
            x = x.copy()
            for part in ablate:
                x[:, PART_SLICES[part]] = 0.0
        if coral is not None:
            # 대각 CORAL (배치 3) — 부위별 검출 프레임(part_mask=1)의 피처를 라이브
            # 분포 → 스튜디오 분포로 정렬. mode=mean 은 평행이동만 (σ 정렬이 판별
            # 분산을 죽일 위험 회피 변형). ⚠️ 16:9 입력에도 항등이 아니다.
            x = x.copy()
            part_index = {p: i for i, p in enumerate(("pose", "right_hand", "left_hand", "face"))}
            for part in coral["parts"]:
                lo, hi = PART_SLICES[part].start, PART_SLICES[part].stop
                sel = pp.part_mask[:, part_index[part]] == 1
                if not sel.any():
                    continue
                mu_l, sd_l = coral["mu_live"][lo:hi], coral["sd_live"][lo:hi]
                mu_s, sd_s = coral["mu_st"][lo:hi], coral["sd_st"][lo:hi]
                if coral["mode"] == "mean":
                    x[np.ix_(sel, range(lo, hi))] += (mu_s - mu_l).astype(np.float32)
                else:
                    z = (x[np.ix_(sel, range(lo, hi))] - mu_l) / np.maximum(sd_l, 1e-3)
                    x[np.ix_(sel, range(lo, hi))] = (z * sd_s + mu_s).astype(np.float32)
        lg = None
        if proto is not None:
            import torch

            feats = torch.from_numpy(x.astype(np.float32)).unsqueeze(0)
            mask = torch.zeros(1, x.shape[0], dtype=torch.bool)
            with torch.no_grad():
                lg = state.model(feats, mask).squeeze(0).numpy()
        return state.predict_probs(x), lg, pp

    if bundle is None:
        probs, logits, pp = run_once(frames, kp, source_aspect)
    else:
        probs_list, logits_list = [], []
        pp = None
        for vb, ar_mult in tta_variants(bundle, tta):
            fr, kpv = frames_from_bundle(vb)
            p, lg, pp_v = run_once(fr, kpv, source_aspect * ar_mult)
            probs_list.append(p)
            if lg is not None:
                logits_list.append(lg)
            if pp is None:
                pp = pp_v  # 첫 변형(항등)의 전처리 정보를 진단에 사용
        probs = np.mean(probs_list, axis=0)
        logits = np.mean(logits_list, axis=0) if logits_list else None

    # ---- 후처리 (배치 3) — 보정(prior) → 조건부 사전확률(hand) → 프로토타입 재랭킹
    if prior is not None:
        # EM 라벨 시프트 보정: p'(y|x) ∝ p(y|x)/π̂(y) (균등 목표 사전확률로 사영).
        # 현행 debias(평균 log-softmax 제거)와는 --debias-alpha 0 으로 A/B 한다.
        p = probs / np.maximum(prior, 1e-8)
        probs = p / p.sum()
    if hand_prior is not None:
        two_hand_mask, delta, thresh = hand_prior
        left_fill = float(pp.part_mask[:, 2].mean())  # PARTS 순서: pose, rh, lh, face
        if left_fill >= thresh:
            # 왼손 슬롯이 충분히 관측된 세그먼트 → two_hand 단어 log-prob 가산.
            # 왼손 미관측이면 중립 (비대칭 — 한손 재조음 케이스 보호)
            lp = np.log(np.maximum(probs, 1e-12))
            lp[two_hand_mask] += delta
            e = np.exp(lp - lp.max())
            probs = e / e.sum()
    if proto is not None and logits is not None:
        bank_logits, bank_labels, k, beta = proto
        sim = (
            bank_logits
            @ logits
            / (np.linalg.norm(bank_logits, axis=1) * np.linalg.norm(logits) + 1e-9)
        )
        nn = np.argsort(sim)[::-1][:k]
        vote = np.zeros_like(probs)
        for i in nn:
            vote[bank_labels[i]] += 1.0 / k
        probs = (1.0 - beta) * probs + beta * vote

    top_idx = np.argsort(probs)[::-1][:TOP_K]
    candidates = [
        {"label": state.class_entries[i].label, "confidence": float(probs[i])} for i in top_idx
    ]
    top_labels = [c["label"] for c in candidates]
    # 정답의 전체 순위 (top-4 밖이어도) — 근접 실패 분석용
    full_rank = int(
        next(
            r
            for r, i in enumerate(np.argsort(probs)[::-1], start=1)
            if state.class_entries[i].label == label
        )
    )
    return {
        "clip_id": data["clip_id"],
        "label": label,
        "n_frames": len(frames),
        "source_wh": [data["source_width"], data["source_height"]],
        "source_aspect_used": pp.source_aspect,
        "x_scale": pp.x_scale,
        "y_scale": pp.y_scale,
        "model_frames": pp.model_frame_count,
        "detection_rates": pp.part_detection_rates,
        "assembly": assembly_summary,
        "candidates": candidates,
        "top1": top_labels[0],
        "top1_conf": candidates[0]["confidence"],
        "top1_correct": top_labels[0] == label,
        "topk_correct": label in top_labels,
        "label_rank": full_rank,
        "rejected": candidates[0]["confidence"] < state.reject_threshold,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--eval-dir",
        type=Path,
        default=DEFAULT_EVAL_DIR,
        help="라벨된 라이브 클립 디렉토리 (기본: ../Ear-Dream-Model/data/live_eval)",
    )
    ap.add_argument(
        "--no-ar",
        action="store_true",
        help="AR 보정 끄기 (source_aspect 를 16/9 로 강제 → x_scale=1.0)",
    )
    ap.add_argument("--json", type=Path, default=None, help="클립별 상세 JSON 저장 경로")
    ap.add_argument(
        "--frames-dir",
        type=Path,
        default=None,
        help="프레임 캐시 디렉토리 (기본: {eval-dir}/frames_tasks)",
    )
    ap.add_argument(
        "--holistic",
        action="store_true",
        help="Holistic(legacy) 캐시 형식 — 추출기 슬롯 직접 사용, assemble_frames 우회",
    )
    ap.add_argument(
        "--ablate",
        default="",
        help="부위 절제 (쉼표 구분: pose,right_hand,left_hand,face) — 피처 열 0-채움",
    )
    ap.add_argument(
        "--mirror",
        action="store_true",
        help="미러링 가설 검증 — 좌표 좌우 반전 + 손 슬롯/라벨 교환 (face 는 근사)",
    )
    ap.add_argument(
        "--fill",
        choices=["hold", "interp"],
        default=None,
        help="결측 채움: hold=직전 검출값 유지, interp=선형 보간 (결측 손 OOD 가설)",
    )
    ap.add_argument(
        "--fill-parts",
        choices=["hands", "all"],
        default="hands",
        help="채움 대상: hands=손 슬롯만, all=pose/face 결측까지",
    )
    ap.add_argument(
        "--tta",
        choices=["ar", "time", "both"],
        default=None,
        help="테스트타임 앙상블: ar=AR 배율 지터 5개, time=시간 창 3개, both=15개 (softmax 평균)",
    )
    ap.add_argument(
        "--y-scale",
        type=float,
        default=None,
        help="전 부위 y 보정 배율 오버라이드 (기본: 서빙 settings.live_y_scale. 1.0=끔)",
    )
    ap.add_argument(
        "--smooth", type=int, default=0, help="시간축 이동평균 창 (0=끔, 3부터 — 결측 인지)"
    )
    ap.add_argument(
        "--resample-interp",
        action="store_true",
        help="30fps 리샘플을 최근접 선택 대신 좌표 선형 보간으로",
    )
    ap.add_argument(
        "--debias",
        type=Path,
        default=None,
        help="편향 벡터 .npy 오버라이드 (기본: 번들 live_debias.npy — 모델 로드 시 적재)",
    )
    ap.add_argument(
        "--debias-alpha",
        type=float,
        default=None,
        help="편향 제거 강도 α 오버라이드 (기본: 서빙 settings.debias_alpha. 0=끔)",
    )
    # ---- 배치 3 옵션
    ap.add_argument(
        "--coral",
        type=Path,
        default=None,
        help="대각 CORAL 통계 .npz (live_stats.npz — mu/sd 라이브는 y_scale 값으로 자동 선택)",
    )
    ap.add_argument(
        "--coral-parts",
        choices=["pose", "pose_face", "all"],
        default="pose",
        help="CORAL 적용 부위",
    )
    ap.add_argument(
        "--coral-mode",
        choices=["full", "mean"],
        default="full",
        help="full=μσ 정렬, mean=μ 평행이동만 (판별 분산 보존 변형)",
    )
    ap.add_argument(
        "--coral-studio",
        type=Path,
        default=None,
        help="스튜디오 통계 .npz (real09_gate_bank.npz — mu_st/sd_st)",
    )
    ap.add_argument(
        "--hand-prior",
        type=Path,
        default=None,
        help="vocab300_handedness.json — 왼손 관측 조건부 two_hand 사전확률 가산",
    )
    ap.add_argument("--hand-prior-delta", type=float, default=0.7, help="log-prob 가산량 δ")
    ap.add_argument("--hand-prior-thresh", type=float, default=0.3, help="왼손 슬롯 채움율 임계")
    ap.add_argument(
        "--trim-lead-tail",
        type=int,
        default=None,
        help="손 없는 리드/테일 트리밍 마진(프레임). 예: 5",
    )
    ap.add_argument(
        "--proto",
        type=Path,
        default=None,
        help="REAL09 로짓 뱅크 .npz (real09_gate_bank.npz) — cosine kNN 재랭킹",
    )
    ap.add_argument("--proto-k", type=int, default=15, help="kNN 이웃 수")
    ap.add_argument("--proto-beta", type=float, default=0.5, help="투표 혼합 비율 β (1.0=투표만)")
    ap.add_argument(
        "--prior",
        type=Path,
        default=None,
        help="EM 라벨 시프트 π̂ .npy — p/π̂ 균등 사영 (현행 debias 와는 --debias-alpha 0 로 A/B)",
    )
    args = ap.parse_args()
    ablate = tuple(p for p in args.ablate.split(",") if p)
    for p in ablate:
        if p not in PART_SLICES:
            sys.exit(f"--ablate 에 모르는 부위: {p} (가능: {', '.join(PART_SLICES)})")

    state = get_model_state()
    if not state.loaded:
        sys.exit(f"model load failed: {state.error}")
    vocab_labels = {e.label for e in state.class_entries}

    # ---- 서빙 기본값 위에 러너 오버라이드 (모듈 docstring — 이중 적용 없음)
    y_scale = args.y_scale if args.y_scale is not None else settings.live_y_scale
    if args.debias is not None:
        state.debias_bias = np.load(args.debias).astype(np.float64)
        if state.debias_alpha == 0.0 and args.debias_alpha is None:
            state.debias_alpha = float(settings.debias_alpha)  # 벡터를 줬으면 켠 것으로 본다
    if args.debias_alpha is not None:
        state.debias_alpha = float(args.debias_alpha)
    debias_active = state.debias_bias is not None and state.debias_alpha != 0.0

    # ---- 배치 3 리소스 적재
    coral = None
    if args.coral is not None:
        live = np.load(args.coral)
        studio = np.load(args.coral_studio) if args.coral_studio else live
        suffix = "l205" if abs(y_scale - 1.205) < 1e-6 else "l100"
        if abs(y_scale - 1.205) >= 1e-6 and y_scale != 1.0:
            sys.exit(f"--coral 라이브 통계는 y_scale 1.205/1.0 만 준비돼 있다 (현재 {y_scale})")
        parts_map = {
            "pose": ["pose"],
            "pose_face": ["pose", "face"],
            "all": ["pose", "right_hand", "left_hand", "face"],
        }
        coral = {
            "mu_live": live[f"mu_{suffix}"],
            "sd_live": live[f"sd_{suffix}"],
            "mu_st": studio["mu_st"],
            "sd_st": studio["sd_st"],
            "parts": parts_map[args.coral_parts],
            "mode": args.coral_mode,
        }
    hand_prior = None
    if args.hand_prior is not None:
        hd = json.loads(args.hand_prior.read_text(encoding="utf-8"))["words"]
        two_hand = np.array(
            [hd.get(e.label, {}).get("articulation") == "two_hand" for e in state.class_entries]
        )
        hand_prior = (two_hand, args.hand_prior_delta, args.hand_prior_thresh)
    proto = None
    if args.proto is not None:
        bank = np.load(args.proto)
        proto = (
            bank["logits"].astype(np.float64),
            bank["labels"].astype(np.int64),
            args.proto_k,
            args.proto_beta,
        )
    prior_vec = np.load(args.prior) if args.prior is not None else None

    labels = load_labels(args.eval_dir)
    cache_dir = args.frames_dir or (args.eval_dir / "frames_tasks")
    rows: list[dict[str, Any]] = []
    skipped: list[str] = []
    for path in sorted(cache_dir.glob("*.json.gz")):
        clip_id = nfc(path.stem.replace(".json", ""))
        info = labels.get(clip_id)
        if info is None:
            skipped.append(f"{clip_id} (라벨 없음)")
            continue
        if info["word"] not in vocab_labels:
            skipped.append(f"{clip_id} (vocab 밖: {info['word']})")
            continue
        row = eval_clip(
            path,
            info["word"],
            apply_ar=not args.no_ar,
            holistic=args.holistic,
            state=state,
            y_scale=y_scale,
            ablate=ablate,
            mirror=args.mirror,
            fill=args.fill,
            fill_parts=args.fill_parts,
            smooth=args.smooth,
            resample_interp=args.resample_interp,
            tta=args.tta,
            coral=coral,
            hand_prior=hand_prior,
            trim_margin=args.trim_lead_tail,
            proto=proto,
            prior=prior_vec,
        )
        row["signer_id"] = info["signer_id"]
        rows.append(row)
        mark = "O" if row["top1_correct"] else ("k" if row["topk_correct"] else "X")
        rej = " REJ" if row["rejected"] else ""
        print(
            f"[{mark}]{rej} {clip_id}: 정답={row['label']} top1={row['top1']}"
            f"({row['top1_conf']:.3f}) rank={row['label_rank']}",
            flush=True,
        )

    n = len(rows)
    if n == 0:
        sys.exit("평가 대상 클립이 없다 — frames_tasks 캐시와 labels.csv 를 확인하라")

    top1 = sum(r["top1_correct"] for r in rows)
    topk = sum(r["topk_correct"] for r in rows)
    rejected = sum(r["rejected"] for r in rows)
    confs = np.array([r["top1_conf"] for r in rows])
    det = {
        part: float(np.mean([r["detection_rates"][part] for r in rows]))
        for part in ("pose", "right_hand", "left_hand", "face")
    }
    per_word: dict[str, list[dict]] = {}
    for r in rows:
        per_word.setdefault(r["label"], []).append(r)
    top1_errors = Counter(r["top1"] for r in rows if not r["top1_correct"])

    extractor = "holistic" if args.holistic else "tasks"
    condition = f"{extractor} + " + ("AR보정 OFF (x_scale=1.0)" if args.no_ar else "AR보정 ON")
    if ablate:
        condition += f" + 절제[{','.join(ablate)}]"
    if args.mirror:
        condition += " + 미러"
    if args.fill:
        condition += f" + 채움[{args.fill}/{args.fill_parts}]"
    if args.tta:
        condition += f" + TTA[{args.tta}]"
    if y_scale != 1.0:
        condition += f" + y스케일[{y_scale}]"
    if args.smooth:
        condition += f" + 스무딩[{args.smooth}]"
    if args.resample_interp:
        condition += " + 리샘플보간"
    if debias_active:
        condition += f" + 편향제거[α={state.debias_alpha}]"
    if coral is not None:
        condition += f" + CORAL[{args.coral_parts}/{args.coral_mode}]"
    if hand_prior is not None:
        condition += f" + 손사전확률[δ={args.hand_prior_delta}/th={args.hand_prior_thresh}]"
    if args.trim_lead_tail is not None:
        condition += f" + 리드테일트림[±{args.trim_lead_tail}f]"
    if proto is not None:
        condition += f" + 프로토kNN[k={args.proto_k}/β={args.proto_beta}]"
    if prior_vec is not None:
        condition += " + EM사전확률보정"
    print(f"\n=== {condition} | 클립 {n}개 / 단어 {len(per_word)}종 ===")
    print(f"top-1: {top1}/{n} = {top1 / n:.1%}   top-{TOP_K}: {topk}/{n} = {topk / n:.1%}")
    print(
        f"reject(<{state.reject_threshold}): {rejected}/{n} = {rejected / n:.1%}   "
        f"conf 평균 {confs.mean():.3f} / 중앙값 {float(np.median(confs)):.3f} / "
        f"최소 {confs.min():.3f} / 최대 {confs.max():.3f}"
    )
    print(f"검출률 평균: {', '.join(f'{k}={v:.1%}' for k, v in det.items())}")
    print("\n단어별 top-1 (정답/클립):")
    for word in sorted(per_word):
        wr = per_word[word]
        c = sum(r["top1_correct"] for r in wr)
        detail = (
            ""
            if c == len(wr)
            else "  → "
            + ", ".join(f"{r['top1']}(rank{r['label_rank']})" for r in wr if not r["top1_correct"])
        )
        print(f"  {word}: {c}/{len(wr)}{detail}")
    if top1_errors:
        print("\n오답 top-1 쏠림:", dict(top1_errors.most_common(8)))
    if skipped:
        print(f"\n제외 {len(skipped)}클립:", "; ".join(skipped))

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(
                {
                    "condition": condition,
                    "n_clips": n,
                    "top1_acc": top1 / n,
                    "topk_acc": topk / n,
                    "top_k": TOP_K,
                    "reject_threshold": state.reject_threshold,
                    "rejected": rejected,
                    "temperature": state.temperature,
                    "y_scale": y_scale,
                    "debias_alpha": state.debias_alpha,
                    "debias_loaded": state.debias_bias is not None,
                    "model_version": state.model_version,
                    "mean_detection_rates": det,
                    "clips": rows,
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"\n상세 JSON 저장: {args.json}")


if __name__ == "__main__":
    main()
