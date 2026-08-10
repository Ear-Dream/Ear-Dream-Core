"""서빙 전처리 — 모델 레포 `src/dataset.py`의 **eval 경로만** 포팅한 것.

파이프라인 (KSLDataset.__getitem__ 의 train=False 분기와 동일해야 한다):
  [use_z=False: zero_z] → trim_rest → normalize_signer(v2: 등방) → interpolate_nan
  → uniform_grid 리샘플(T=32) → velocity_channel → 평탄화 (32, 780) float32 → nan_to_num

⚠️ 학습된 가중치와 다른 전처리를 만들지 말 것 (설계 결정 1 / train-serve skew).
   - 증강(flip/affine/finger dropout/masking)은 서빙에 없다.
   - **전처리 v2 (PREPROCESS_VERSION="2")**: 정규화 직전에 픽셀 비율 복원
     `x ← x × AR` (AR = source_width/height) 을 적용한다 — v2 재학습 모델이
     이 등방(isotropic) 좌표계로 학습됐다 (핸드오프 07_serving_handoff.md §3-1).
     AR 은 요청의 `capture.source_width/height` 실측값에서 온다.
   - v1 시절의 "종횡비 보정 금지" 원칙은 v2 재학습으로 대체됐다. 등방 정규화 외의
     추가 보정(좌표 반올림·클리핑 등)은 여전히 넣지 않는다.
   - **use_z 분기 (핸드오프 09_z_gap_response.md §3-2)**: 체크포인트 use_z=False 면
     z 를 0 으로 고정한다(위치·속도 모두 — 속도는 z=0 위치의 차분이라 자동으로 0).
     shape (T, 780) 은 유지 — 채널 제거가 아니다. 적용 위치는 dataset.py
     __getitem__ 의 0단계(트리밍 이전)와 동일하다. use_z 값은 임의 설정이 아니라
     체크포인트 wrapper 에서 온다 (model.py 가 로드 시 읽는다).

각 함수 본문은 dataset.py 에서 그대로 복사했다. 수정 시 모델 레포와 동시에 바꿔야 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.ml.keypoint_layout import (
    FEAT_DIM,
    L_SHOULDER,
    LEFT_HAND,
    N_KP,
    R_SHOULDER,
    RIGHT_HAND,
)

# 전처리 계약 버전 — 모델 레포 dataset.py 의 PREPROCESS_VERSION 과 동기화 (2026-08-10 시점).
#   "2": 정규화 직전 픽셀 비율 복원 x ← x × AR 후 어깨 정규화 (종횡비 불변 · 등방)
# 체크포인트 wrapper 의 preprocess_version 과 불일치하면 model.py 가 로드를 거부한다.
PREPROCESS_VERSION = "2"

TARGET_T = 32  # dataset.py DEFAULT_T — 서빙 대상 체크포인트가 T=32 로 학습됨
MIN_TRIM_LEN = 8  # dataset.py MIN_TRIM_LEN


# ================================================================ 전처리 단계
def trim_rest_bounds(kp: np.ndarray) -> tuple[int, int]:
    """trim_rest 와 동일한 로직으로 [start, end) 경계만 계산한다.

    응답의 used_start/used_end 정보를 위해 경계를 따로 노출한다.
    슬라이스 결과는 dataset.py 의 trim_rest(kp) 와 반드시 일치한다.
    """
    if kp.shape[0] == 0:
        return 0, 0
    left_missing = np.isnan(kp[:, LEFT_HAND, :]).all(axis=(1, 2))
    right_missing = np.isnan(kp[:, RIGHT_HAND, :]).all(axis=(1, 2))
    active = ~(left_missing & right_missing)
    if not active.any():
        return 0, kp.shape[0]
    idx = np.nonzero(active)[0]
    start, end = int(idx[0]), int(idx[-1] + 1)
    if end - start < MIN_TRIM_LEN:
        return 0, kp.shape[0]
    return start, end


def trim_rest(kp: np.ndarray) -> np.ndarray:
    """앞뒤 rest 구간 제거: 양손 모두 미검출인 leading/trailing 프레임을 잘라낸다."""
    start, end = trim_rest_bounds(kp)
    return kp[start:end]


def zero_z(kp: np.ndarray) -> np.ndarray:
    """z 채널 0 고정 (use_z=False 경로). NaN 패턴은 보존한다 — trim/보간 로직이
    '전 좌표 NaN = 미검출' 규약에 의존하므로 NaN 위치를 0으로 바꾸면 안 된다.
    """
    out = kp.copy()
    z = out[:, :, 2]
    out[:, :, 2] = np.where(np.isnan(z), np.nan, 0.0)
    return out


def normalize_signer(kp: np.ndarray, aspect_ratio: float | None = None) -> np.ndarray:
    """수어자 불변 정규화: 프레임별 어깨 중점을 원점으로, 샘플 중앙값 어깨 너비=1 스케일.

    aspect_ratio (전처리 v2, PREPROCESS_VERSION="2"):
        None  → v1 경로: MediaPipe 정규화 좌표(x/W, y/H)를 그대로 사용 (종횡비 의존).
        float → 픽셀 비율 복원 `x ← x × AR` (AR = W/H) 를 정규화 직전에 적용.
                이후 어깨 중점 원점·어깨 너비=1 스케일이 등방(isotropic) 공간에서
                수행되어 16:9 / 9:16 입력이 같은 기하로 정규화된다.
    """
    kp = kp.astype(np.float32).copy()
    if aspect_ratio is not None:
        kp[:, :, 0] *= np.float32(aspect_ratio)
    ls = kp[:, L_SHOULDER, :]  # (T, 3)
    rs = kp[:, R_SHOULDER, :]

    center = (ls + rs) / 2.0  # (T, 3)
    width = np.linalg.norm((ls - rs)[:, :2], axis=1)  # (T,) xy 평면 어깨 너비

    # 어깨 미검출 프레임은 샘플 내 유효 프레임 통계로 대체
    valid = ~np.isnan(center).any(axis=1) & ~np.isnan(width) & (width > 1e-6)
    if valid.any():
        fallback_center = np.nanmedian(center[valid], axis=0)
        fallback_width = float(np.nanmedian(width[valid]))
        center = np.where(np.isnan(center).any(axis=1, keepdims=True), fallback_center, center)
        scale = fallback_width
    else:  # 어깨가 한 번도 안 잡힌 극단 케이스 — 프레임 중앙 fallback
        cx = 0.5 if aspect_ratio is None else 0.5 * float(aspect_ratio)
        center = np.zeros_like(center)
        center[:] = (cx, 0.5, 0.0)
        scale = 0.25

    kp = kp - center[:, None, :]
    kp = kp / max(scale, 1e-6)
    return kp


def interpolate_nan(kp: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """키포인트·좌표별 시간축 선형 보간. 가장자리는 최근접 값으로 채움.

    반환: (보간된 kp, mask) — mask: (T, 130) float32, 검출=1 / 보간·미검출=0.
    전 구간 미검출 트랙은 0으로 채운다(마스킹).
    """
    T = kp.shape[0]
    mask = (~np.isnan(kp).any(axis=2)).astype(np.float32)  # (T, 130)
    flat = kp.reshape(T, -1)  # (T, 390)
    t = np.arange(T, dtype=np.float64)
    out = flat.copy()
    for c in range(flat.shape[1]):
        col = flat[:, c]
        bad = np.isnan(col)
        if not bad.any():
            continue
        good = ~bad
        if not good.any():
            out[:, c] = 0.0
            continue
        out[bad, c] = np.interp(t[bad], t[good], col[good])
    return out.reshape(T, N_KP, 3), mask


def resample_to(kp: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """실수 프레임 인덱스 grid (길이 T_out, 값 ∈ [0, T_in-1]) 로 선형 리샘플."""
    T_in = kp.shape[0]
    flat = kp.reshape(T_in, -1)
    lo = np.floor(grid).astype(np.int64)
    hi = np.minimum(lo + 1, T_in - 1)
    w = (grid - lo).astype(np.float32)[:, None]
    out = flat[lo] * (1.0 - w) + flat[hi] * w
    return out.reshape(len(grid), N_KP, 3)


def uniform_grid(T_in: int, T_out: int) -> np.ndarray:
    if T_in <= 1:
        return np.zeros(T_out, dtype=np.float64)
    return np.linspace(0.0, T_in - 1.0, T_out)


def velocity_channel(kp: np.ndarray) -> np.ndarray:
    """v[t] = p[t] - p[t-1], v[0] = 0. kp: (T, 130, 3)."""
    v = np.zeros_like(kp)
    if kp.shape[0] > 1:
        v[1:] = kp[1:] - kp[:-1]
    return v


# ================================================================ eval 파이프라인
@dataclass
class PreprocessOutput:
    x: np.ndarray  # (TARGET_T, FEAT_DIM) float32, NaN 0개 보장
    used_start_index: int  # 트리밍 후 사용한 원본 프레임 [start, end)
    used_end_index: int
    used_frame_count: int  # 트리밍 후 프레임 수 (리샘플 전)
    interpolated_frame_count: int  # 결측 키포인트가 있어 보간이 개입한 프레임 수


def preprocess_eval(kp: np.ndarray, *, aspect_ratio: float, use_z: bool) -> PreprocessOutput:
    """(T_raw, 130, 3) NaN 포함 배열 → 모델 입력 (32, 780).

    KSLDataset.__getitem__ 의 eval 경로(0→1→3→6→8→10→NaN 방어선)와 순서·연산이 동일하다.
    aspect_ratio: 소스 프레임 W/H (요청 capture.source_width/height 실측값) —
    v2 등방 정규화의 픽셀 비율 복원에 쓰인다. 세로 720×1280 이면 0.5625.
    use_z: 체크포인트 wrapper 의 use_z (ModelState.use_z 에서 배선). False 면 z 를
    0 으로 고정한다 — 학습 계약이므로 호출부가 임의로 정하지 말 것.
    """
    assert kp.ndim == 3 and kp.shape[1:] == (N_KP, 3), f"expected (T,{N_KP},3), got {kp.shape}"
    kp = kp.astype(np.float32)

    # 0) z 채널 옵션 (NaN 패턴 보존 — trim/보간 규약 유지)
    if not use_z:
        kp = zero_z(kp)

    # 1) 트리밍
    start, end = trim_rest_bounds(kp)
    kp = kp[start:end]
    if kp.shape[0] == 0:
        kp = np.zeros((2, N_KP, 3), dtype=np.float32)
        start, end = 0, 0

    used_frame_count = int(kp.shape[0])

    # 3) 수어자 불변 정규화 (v2: 픽셀 비율 복원 x ← x×AR 포함)
    kp = normalize_signer(kp, aspect_ratio=aspect_ratio)

    # 6) NaN 보간 + mask (2·4·5·7=증강 단계는 eval 경로에 없음)
    kp, mask = interpolate_nan(kp)
    interpolated_frames = int((mask.min(axis=1) < 1.0).sum())

    # 8) 시간 리샘플 (eval: uniform grid)
    grid = uniform_grid(kp.shape[0], TARGET_T)
    kp = resample_to(kp, grid)  # (32, 130, 3)

    # 10) 속도 채널 + 평탄화 (9=finger dropout 은 eval 경로에 없음)
    vel = velocity_channel(kp)
    x = np.concatenate([kp.reshape(TARGET_T, -1), vel.reshape(TARGET_T, -1)], axis=1)

    # NaN 0개 보장 (최종 방어선)
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    assert x.shape == (TARGET_T, FEAT_DIM), f"bad shape {x.shape}"

    return PreprocessOutput(
        x=x.astype(np.float32),
        used_start_index=start,
        used_end_index=end,
        used_frame_count=used_frame_count,
        interpolated_frame_count=interpolated_frames,
    )
