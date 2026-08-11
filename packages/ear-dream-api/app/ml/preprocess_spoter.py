"""SPOTER-208 서빙 전처리 — 전처리 계약 `spoter2_mp_xy_v1` 의 포팅.

정본은 두 곳이다 (수치가 그대로 일치해야 한다 — train/serve skew 방지):
  - 계약 문서: 「AI Hub 한국 수어 단어 분류용 MediaPipe 전처리」 (Notion)
  - 레퍼런스 구현: preprocess_one_video.py 의 process()/normalize_pose()/
    normalize_local()/FACE_INDICES (tests/test_preprocess_spoter.py 가 인라인 복사본과
    수치 대조한다)

파이프라인 ([T_raw 프레임] → [T, 208] float32):
  프레임별 208 특징 = global_pose(25×2=50) → local_right_hand(21×2=42)
                    → local_left_hand(21×2=42) → local_face(37×2=74)
  - pose:  0~24 xy, 어깨 중점 원점 / 1.5×어깨거리 스케일 global 정규화 (회전 정렬 없음)
  - hands: 각 21 xy, square bbox + padding 0.2 → [-1, 1] local 정규화
  - face:  478점 중 FACE_INDICES 37점 xy (468·473 홍채 포함 — **478점 메쉬 필수**),
           hands 와 같은 local 정규화
  - 결측: **프레임 삭제 금지·보간 금지** — 부위 미검출은 해당 폭 0-채움 + part_mask 0.
    v2 의 trim_rest/interpolate_nan/uniform_grid 경로는 이 계약에 존재하지 않는다 —
    재사용 금지 (계약 문서 §7·§10.1).

시간축:
  - 학습 데이터는 AI Hub 30fps 전 구간이다. 라이브 캡처는 가변 fps 이므로 t_ms 기준
    30fps 그리드에 **최근접 프레임 선택**으로 리샘플한다 (계약 문서 §10.2 취지).
    ⚠️ 임시 정책 — 좌표 보간 없이 프레임 단위 선택만 하는 보수적 구현이다.
    실측(라벨된 라이브 데이터)으로 검증되지 않았다.
  - 256 프레임 초과 시 uniform temporal sampling (§10.3) — 학습 데이터로더
    SignH5Dataset 과 **동일한** np.linspace(...).round() 인덱스 선택을 쓴다.

손 좌우 슬롯: 학습 추출기(Holistic)는 좌/우 슬롯을 모델이 제공하지만 라이브는 분리
3모델이라 서버가 배정한다 — app/ml/assembly.assemble_frames (포즈 손목 기하 매칭,
실사용 검증 완료)의 결과 배열에서 LEFT_HAND/RIGHT_HAND 슬롯의 **원본 좌표**를 읽는다.
assembly 는 배정만 하고 좌표를 가공하지 않으므로 여기서 읽는 값은 MediaPipe 원본이다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from app.ml.keypoint_layout import LEFT_HAND, RIGHT_HAND
from app.schemas.landmark import LandmarkFrame

# 전처리 계약 버전 — 학습 산출물(release.json feature_version)과 일치해야 로드된다
PREPROCESS_VERSION = "spoter2_mp_xy_v1"

FEAT_DIM = 208
POSE_POINT_COUNT = 25  # MediaPipe pose 0~24
HAND_POINT_COUNT = 21
# 레퍼런스 구현의 FACE_INDICES 그대로 (37점). 468·473 은 홍채 — refine 없는 468점
# 메쉬에는 존재하지 않으므로 이 계약은 478점 페이로드를 요구한다.
FACE_INDICES = [
    0, 4, 13, 14, 17, 33, 39, 46, 52, 55, 61, 64, 81,
    93, 133, 151, 152, 159, 172, 178, 181, 263, 269, 276,
    282, 285, 291, 294, 311, 323, 362, 386, 397, 402, 405,
    468, 473,
]  # fmt: skip
FACE_POINT_COUNT_REQUIRED = 478

# 부위 순서 (part_mask 열 순서 — 계약 문서 §7.2 / 레퍼런스 PARTS 와 동일)
PARTS = ("pose", "right_hand", "left_hand", "face")

# ⚠️ 임시값 — 학습 데이터(AI Hub) 실측 fps. 리샘플 정책 자체가 임시다 (모듈 docstring).
TARGET_FPS = 30.0
# 학습 config max_sequence_length=256 (SignH5Dataset 과 동일한 상한·선택 방식)
MAX_MODEL_FRAMES = 256


# ================================================================ 정규화 (레퍼런스 동일)
def normalize_pose(points: np.ndarray, eps: float = 1e-6) -> np.ndarray | None:
    """global 정규화: 어깨 중점 원점 / 1.5×어깨거리 스케일. 회전 정렬 없음.

    레퍼런스 preprocess_one_video.normalize_pose 와 본문 동일 — 수정 시 동시 변경.
    """
    center = (points[11] + points[12]) / 2.0
    shoulder_distance = float(np.linalg.norm(points[11] - points[12]))
    if not np.isfinite(shoulder_distance) or shoulder_distance <= eps:
        return None
    return (points - center) / (1.5 * shoulder_distance)


def normalize_local(
    points: np.ndarray, padding: float = 0.2, eps: float = 1e-6
) -> np.ndarray | None:
    """local 정규화: square bbox + padding → [-1, 1].

    레퍼런스 preprocess_one_video.normalize_local 과 본문 동일 — 수정 시 동시 변경.
    """
    low, high = points.min(axis=0), points.max(axis=0)
    side = float(np.max(high - low))
    if not np.isfinite(side) or side <= eps:
        return None
    center = (low + high) / 2.0
    return (points - center) / (side * (0.5 + padding))


# ================================================================ 프레임별 특징
def _part_points(frame: LandmarkFrame, kp130_row: np.ndarray, name: str) -> np.ndarray | None:
    """부위별 (N, 2) float32 원본 xy — 미검출이면 None.

    hands 는 assembly 가 배정한 슬롯(kp130 의 LEFT_HAND/RIGHT_HAND 블록, 원본 좌표)에서
    읽는다. pose/face 는 요청 프레임에서 직접 읽는다 — pose 는 visibility 마스킹 없이
    25점 전부 쓴다 (학습 추출기 Holistic 은 검출 여부만 봤다. kp130 의 pose 블록은
    visibility 마스킹된 10점 서브셋이라 이 계약에는 쓸 수 없다).
    """
    if name == "pose":
        if frame.pose is None:
            return None
        return np.asarray(frame.pose.landmarks, dtype=np.float32)[:POSE_POINT_COUNT, :2]
    if name in ("right_hand", "left_hand"):
        slot = RIGHT_HAND if name == "right_hand" else LEFT_HAND
        pts = kp130_row[slot, :2]
        if np.isnan(pts).any():  # 슬롯 미배정(미검출) — assembly 는 결측을 NaN 으로 둔다
            return None
        return pts.astype(np.float32)
    if name == "face":
        if frame.face is None:
            return None
        pts = np.asarray(frame.face.landmarks, dtype=np.float32)
        if pts.shape[0] != FACE_POINT_COUNT_REQUIRED:
            # 468점(홍채 미포함) 메쉬는 FACE_INDICES 의 468·473 을 인덱싱할 수 없다.
            # 스키마(face_point_counts=[478])가 이미 422 로 거르지만, 우회 경로 방어로
            # 얼굴 미검출과 동일하게 강등한다 (0-채움 + part_mask 0).
            return None
        return pts[FACE_INDICES, :2]
    raise ValueError(f"unknown part: {name}")


def _frame_features(frame: LandmarkFrame, kp130_row: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """프레임 하나 → (208,) float32 + part_mask (4,) uint8. 레퍼런스 process() 의
    프레임 루프 본문과 동일한 순서·연산이다."""
    features = np.zeros(FEAT_DIM, dtype=np.float32)
    mask = np.zeros(len(PARTS), dtype=np.uint8)
    specs = (
        ("pose", 50, normalize_pose),
        ("right_hand", 42, normalize_local),
        ("left_hand", 42, normalize_local),
        ("face", 74, normalize_local),
    )
    offset = 0
    for part_index, (name, width, normalizer) in enumerate(specs):
        points = _part_points(frame, kp130_row, name)
        if points is not None:
            normalized = normalizer(points)
            if normalized is not None and np.all(np.isfinite(normalized)):
                features[offset : offset + width] = normalized.reshape(-1)
                mask[part_index] = 1
        offset += width
    return features, mask


# ================================================================ 시간축
def resample_indices_30fps(t_ms: np.ndarray, target_fps: float = TARGET_FPS) -> np.ndarray:
    """t_ms (단조증가) → 30fps 그리드의 최근접 프레임 인덱스.

    ⚠️ 임시 정책 (모듈 docstring) — 좌표를 섞지 않는 프레임 단위 최근접 선택.
    그리드는 [t0, t_last] 를 1000/fps ms 간격으로 덮는다 (양 끝 포함)."""
    n = len(t_ms)
    if n <= 1:
        return np.zeros(max(n, 0), dtype=np.int64)
    step = 1000.0 / target_fps
    duration = float(t_ms[-1] - t_ms[0])
    # 1e-6 은 부동소수 오차 허용치 — duration 이 step 의 정확한 배수일 때(예: 정확히
    # 30fps 인 입력) 끝 프레임이 그리드에서 떨어져 나가는 것을 막는다
    n_out = int(np.floor(duration / step + 1e-6)) + 1
    grid = t_ms[0] + np.arange(n_out, dtype=np.float64) * step
    # 최근접 소스 프레임 (동률이면 앞 프레임)
    pos = np.searchsorted(t_ms, grid)
    pos = np.clip(pos, 1, n - 1)
    left, right = t_ms[pos - 1], t_ms[pos]
    choose_right = (grid - left) > (right - grid)
    return np.where(choose_right, pos, pos - 1).astype(np.int64)


def uniform_sample_indices(t_in: int, max_len: int = MAX_MODEL_FRAMES) -> np.ndarray:
    """256 초과 시 uniform temporal sampling — 학습 데이터로더 SignH5Dataset 의
    `np.linspace(0, len-1, max_len).round()` 와 동일해야 한다 (train/serve 일치)."""
    if t_in <= max_len:
        return np.arange(t_in, dtype=np.int64)
    return np.linspace(0, t_in - 1, max_len).round().astype(np.int64)


# ================================================================ 파이프라인
@dataclass
class PreprocessOutput:
    x: np.ndarray  # (T, 208) float32, NaN 0개 보장
    part_mask: np.ndarray  # (T, 4) uint8 — [pose, right_hand, left_hand, face]
    source_frame_count: int  # 요청 원본 프레임 수
    resampled_frame_count: int  # 30fps 리샘플 후 (256 캡 이전)
    model_frame_count: int  # 최종 모델 입력 T

    @property
    def part_detection_rates(self) -> dict[str, float]:
        """부위별 검출 프레임 비율 (진단용)."""
        t = max(self.part_mask.shape[0], 1)
        return {name: float(self.part_mask[:, i].sum()) / t for i, name in enumerate(PARTS)}


def preprocess_spoter(frames: Sequence[LandmarkFrame], kp130: np.ndarray) -> PreprocessOutput:
    """요청 프레임 + assembly 조립 배열 → 모델 입력 (T, 208).

    kp130: assemble_frames 결과 (T_raw, 130, 3) — 손 슬롯 배정 결과만 읽는다.
    """
    assert kp130.shape[0] == len(frames), "kp130 과 frames 길이 불일치"

    per_frame = [_frame_features(frame, kp130[t]) for t, frame in enumerate(frames)]
    features = np.stack([f for f, _ in per_frame])  # (T_raw, 208)
    mask = np.stack([m for _, m in per_frame])  # (T_raw, 4)

    t_ms = np.asarray([f.t_ms for f in frames], dtype=np.float64)
    sel = resample_indices_30fps(t_ms)
    resampled_count = len(sel)
    sel = sel[uniform_sample_indices(resampled_count)]

    x = features[sel]
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)  # 최종 방어선
    return PreprocessOutput(
        x=x.astype(np.float32),
        part_mask=mask[sel],
        source_frame_count=len(frames),
        resampled_frame_count=resampled_count,
        model_frame_count=int(x.shape[0]),
    )
