"""요청 프레임(LandmarkFrame 시퀀스) → 모델 키포인트 배열 (T, 130, 3) 조립.

결측은 전부 NaN 으로 둔다 — 결측치 대치(보간)는 preprocess.interpolate_nan 한 곳에서만
수행한다(설계 결정 1).

손 좌우 배정 규칙 (2026-08-10 개정 — 아카이브 8세션 5,400프레임 실측 근거):
  배정 기준점과 모델 입력 마스킹을 **분리**한다. 모델 입력용 포즈 점은 종전대로
  visibility 임계 미달 시 NaN 이지만, 손 슬롯 배정 매칭은 `frame.pose.landmarks[15/16]`
  **원본 좌표**를 쓴다. 이유: 세로 셀피에서 쉬는 손 손목은 프레임 밖이라 visibility 가
  낮지만(실측 평균 0.34), MediaPipe 는 프레임 밖 점도 좌표를 추정하며 그 좌표만으로
  판별 마진이 명확했다 — 임계 적용 후 좌표를 쓰던 종전 로직은 프레임의 43% 를
  "왼손목 저vis" 사유로 라벨 fallback 에 보냈고, 그 라벨의 간헐 노이즈(~2%)가
  같은 물리 손의 궤적을 두 슬롯으로 분열시켰다.

  1순위 — 포즈 손목 기하 매칭 (원본 좌표): 각 손의 landmark 0(손목)과 포즈 15/16 의
          xy 거리를 비교해 가까운 쪽 슬롯에 배정. 두 손이면 (h0→L, h1→R) vs
          (h0→R, h1→L) 중 거리 합이 최소인 배정.
  가드 — 마진 |dL−dR| < ASSIGN_MARGIN_EPS 면 기하 판정을 보류한다:
          한 손이면 직전 프레임의 단일손 슬롯(연속성), 그것도 없으면 라벨.
          두 손이면 라벨 (두 손 검출 순서는 프레임 간 불안정이라 연속성이 무의미하고,
          라벨은 기하와 99.8% 일치로 신뢰 가능).
  2순위 — 포즈 결측(또는 손목 좌표 비유한)일 때만 handedness 라벨 fallback:
          "Left"→LEFT_HAND, "Right"→RIGHT_HAND. 라벨은 원본 그대로 신뢰한다 —
          실측(기하 성공 2,388프레임)에서 라벨-기하 일치 99.8%, 미러 반전 없음.
          두 손이 같은 슬롯을 다투면 score 가 높은 손이 라벨 슬롯을 갖는다.

  가드를 visibility 바닥값이 아니라 **마진**으로 둔 근거 (전부 실측):
  - visibility 는 좌표 판별력과 무관했다 — 손목 vis 평균 0.10~0.15 인 세션들에서도
    원본 좌표 기하 매칭이 라벨과 100% 일치했고 마진도 ≥ 0.3 이었다. vis 바닥값
    (예: ≥0.1)을 두면 정확히 문제가 됐던 "쉬는 손 프레임 밖" 세션들을 도로 라벨
    fallback 으로 보낸다.
  - 마진 분포: 평균 ~0.9, 파일별 최소 대부분 > 0.3, 전체 최소 0.019, 2손
    straight-vs-swap 중앙값 0.43. EPS=0.05 미만은 극소수 프레임 — 가드는 사실상
    예외 케이스에서만 발동한다.

  슬롯 의미(해부학적 좌우)는 불변 — 추정 방법만 개선이므로 PREPROCESS_VERSION 은
  올리지 않는다.

배정 메타: assemble_frames 는 (배열, AssemblyMeta) 를 반환한다. 프레임별 배정 경로·
기하-라벨 불일치가 실리고, diagnostics 는 AssemblyMeta.summary() 를 그대로 싣는다 —
진단 쪽에서 배정 로직을 중복 재계산하지 않는다(드리프트 방지).

포즈 33점 → 10점 서브셋 + NECK(양어깨 중점) 합성. visibility < 임계(서버 설정)인
점은 NaN 처리한다 — 이 마스킹은 모델 입력용이며 위 배정 매칭과 무관하다.

얼굴 468/478점 → FACE_MESH_IDS 78점 서브셋 (모든 id < 468 이라 양쪽 호환).
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

import numpy as np

from app.ml.keypoint_layout import (
    FACE,
    FACE_MESH_IDS,
    HAND_N,
    L_SHOULDER,
    L_WRIST,
    LEFT_HAND,
    N_KP,
    NECK,
    POSE_MP_IDS,
    R_SHOULDER,
    R_WRIST,
    RIGHT_HAND,
)
from app.schemas.landmark import HandObservation, LandmarkFrame

# MediaPipe pose 원본 인덱스 (keypoint_layout 의 global→mp 매핑에서 역산 — 하드코딩 방지)
_MP_L_WRIST = POSE_MP_IDS[L_WRIST]
_MP_R_WRIST = POSE_MP_IDS[R_WRIST]

# 기하 배정 마진 가드 임계 (정규화 좌표 단위). 근거는 모듈 docstring — 실측 마진 분포
# (평균 ~0.9, 전체 최소 0.019)에서 0.05 미만은 극소수라 가드 발동은 예외 케이스다.
ASSIGN_MARGIN_EPS = 0.05

# 배정 경로 상수 (FrameAssignment.path / summary()["paths"] 키)
PATH_NO_HANDS = "no_hands"
PATH_GEOMETRY = "geometry"  # 원본 손목 좌표 기하 매칭
PATH_CONTINUITY = "continuity"  # 마진 미달 → 직전 프레임 단일손 슬롯 재사용
PATH_FALLBACK_MARGIN = "fallback_margin_label"  # 마진 미달 + 연속성 없음 → 라벨
PATH_FALLBACK_POSE_NULL = "fallback_pose_null"  # 포즈 결측/비유한 → 라벨


@dataclass(frozen=True)
class FrameAssignment:
    """프레임 하나의 손 슬롯 배정 결과 메타."""

    path: str
    hand_count: int
    # 단일손 프레임에서 배정된 슬롯 ("left"/"right") — 궤적 분열(전환 횟수) 판정용
    single_slot: str | None
    # 기하 경로에서 배정이 handedness 라벨과 어긋난 손이 있었는가 (라벨 노이즈 관측용)
    label_mismatch: bool


@dataclass(frozen=True)
class AssemblyMeta:
    """세그먼트 전체의 배정 메타 — diagnostics 는 summary() 만 싣는다."""

    frames: list[FrameAssignment]

    def summary(self) -> dict[str, Any]:
        paths = Counter(fa.path for fa in self.frames)
        singles = [fa.single_slot for fa in self.frames if fa.single_slot is not None]
        return {
            # 경로별 프레임 수 (no_hands 포함 — 전체 합 = 프레임 수)
            "paths": dict(paths),
            # 기하 배정이 라벨과 어긋난 프레임 수 — 실측상 라벨 노이즈 ~2% 의 관측 지표
            "geometry_label_mismatch_frames": sum(fa.label_mismatch for fa in self.frames),
            # 단일손 프레임 연쇄에서 슬롯이 바뀐 횟수 — 궤적 분열이면 값이 커진다.
            # 정상 세그먼트(한 손 사용)는 0 이 기대값이다.
            "single_hand_slot_transitions": sum(a != b for a, b in pairwise(singles)),
        }


def _xy_dist(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))


def _write_hand(out: np.ndarray, hand: HandObservation, slot: list[int]) -> None:
    out[slot, :] = np.asarray(hand.landmarks, dtype=np.float32)[:HAND_N]


def _slot_by_label(hand: HandObservation) -> list[int]:
    return LEFT_HAND if hand.handedness_label.lower() == "left" else RIGHT_HAND


def _slot_name(slot: list[int]) -> str:
    return "left" if slot is LEFT_HAND else "right"


def _raw_wrists(frame: LandmarkFrame) -> tuple[Sequence[float], Sequence[float]] | None:
    """배정 매칭용 포즈 손목 15/16 **원본 좌표** (visibility 마스킹과 무관).

    포즈 결측이거나 손목 xy 가 유한하지 않으면 None → 라벨 fallback 경로.
    """
    if frame.pose is None:
        return None
    lw = frame.pose.landmarks[_MP_L_WRIST]
    rw = frame.pose.landmarks[_MP_R_WRIST]
    if not all(math.isfinite(float(v)) for v in (lw[0], lw[1], rw[0], rw[1])):
        return None
    return lw, rw


def _assign_by_labels(out: np.ndarray, h0: HandObservation, h1: HandObservation) -> None:
    """두 손 라벨 배정 — 같은 슬롯을 다투면 score 가 높은 손이 라벨 슬롯 차지."""
    s0, s1 = _slot_by_label(h0), _slot_by_label(h1)
    if s0 is s1:
        winner, loser = (h0, h1) if h0.handedness_score >= h1.handedness_score else (h1, h0)
        other = RIGHT_HAND if s0 is LEFT_HAND else LEFT_HAND
        _write_hand(out, winner, s0)
        _write_hand(out, loser, other)
    else:
        _write_hand(out, h0, s0)
        _write_hand(out, h1, s1)


def _assign_hands(
    out: np.ndarray,
    hands: list[HandObservation],
    wrists: tuple[Sequence[float], Sequence[float]] | None,
    prev_single_slot: str | None,
) -> FrameAssignment:
    """손 블록을 배정·기록하고 배정 메타를 돌려준다.

    wrists 는 _raw_wrists 결과 (원본 좌표 — 모델 입력 마스킹과 분리),
    prev_single_slot 은 직전 단일손 프레임의 배정 슬롯 (마진 가드의 연속성 tiebreak).
    """
    if not hands:
        return FrameAssignment(PATH_NO_HANDS, 0, None, False)

    if len(hands) == 1:
        hand = hands[0]
        if wrists is None:
            slot, path = _slot_by_label(hand), PATH_FALLBACK_POSE_NULL
        else:
            dl, dr = _xy_dist(hand.landmarks[0], wrists[0]), _xy_dist(hand.landmarks[0], wrists[1])
            if abs(dl - dr) >= ASSIGN_MARGIN_EPS:
                slot, path = (LEFT_HAND if dl <= dr else RIGHT_HAND), PATH_GEOMETRY
            elif prev_single_slot is not None:
                # 마진 극소 = 두 손목 후보의 중간 지점. 같은 물리 손의 궤적이 갈라지지
                # 않게 직전 프레임 슬롯을 잇는다 (실측상 발동 프레임은 극소수).
                slot = LEFT_HAND if prev_single_slot == "left" else RIGHT_HAND
                path = PATH_CONTINUITY
            else:
                slot, path = _slot_by_label(hand), PATH_FALLBACK_MARGIN
        _write_hand(out, hand, slot)
        return FrameAssignment(
            path,
            1,
            _slot_name(slot),
            path == PATH_GEOMETRY and slot is not _slot_by_label(hand),
        )

    h0, h1 = hands[0], hands[1]
    if wrists is None:
        _assign_by_labels(out, h0, h1)
        return FrameAssignment(PATH_FALLBACK_POSE_NULL, 2, None, False)

    lw, rw = wrists
    # 거리 합이 최소가 되는 배정 (2×2 라 두 경우만 비교)
    d_straight = _xy_dist(h0.landmarks[0], lw) + _xy_dist(h1.landmarks[0], rw)
    d_swapped = _xy_dist(h0.landmarks[0], rw) + _xy_dist(h1.landmarks[0], lw)
    if abs(d_straight - d_swapped) < ASSIGN_MARGIN_EPS:
        # 두 손 검출 순서(h0/h1)는 프레임 간 불안정이라 연속성 tiebreak 이 무의미하다 —
        # 기하 99.8% 일치가 실측된 라벨로 푼다.
        _assign_by_labels(out, h0, h1)
        return FrameAssignment(PATH_FALLBACK_MARGIN, 2, None, False)
    if d_straight <= d_swapped:
        pairs = [(h0, LEFT_HAND), (h1, RIGHT_HAND)]
    else:
        pairs = [(h0, RIGHT_HAND), (h1, LEFT_HAND)]
    mismatch = False
    for hand, slot in pairs:
        _write_hand(out, hand, slot)
        mismatch = mismatch or slot is not _slot_by_label(hand)
    return FrameAssignment(PATH_GEOMETRY, 2, None, mismatch)


def assemble_frames(
    frames: Sequence[LandmarkFrame],
    pose_visibility_threshold: float,
) -> tuple[np.ndarray, AssemblyMeta]:
    """LandmarkFrame 시퀀스 → ((T, 130, 3) float32 — 결측 NaN, 배정 메타)."""
    out = np.full((len(frames), N_KP, 3), np.nan, dtype=np.float32)
    assignments: list[FrameAssignment] = []
    prev_single_slot: str | None = None

    for t, frame in enumerate(frames):
        row = out[t]

        # ---- pose: 33점 → 10점 서브셋 (visibility 임계 미달은 NaN 유지 — 모델 입력용
        #      마스킹. 손 배정 매칭은 아래 _raw_wrists 의 원본 좌표를 따로 쓴다)
        if frame.pose is not None:
            lms = frame.pose.landmarks
            vis = frame.pose.visibility
            for global_idx, mp_idx in POSE_MP_IDS.items():
                if vis[mp_idx] >= pose_visibility_threshold:
                    row[global_idx] = lms[mp_idx]
            # NECK 합성: 양어깨가 모두 유효할 때만
            if not np.isnan(row[L_SHOULDER]).any() and not np.isnan(row[R_SHOULDER]).any():
                row[NECK] = (row[L_SHOULDER] + row[R_SHOULDER]) / 2.0

        # ---- face: 468/478 → 78점 서브셋 (FACE_MESH_IDS 는 전부 < 468)
        if frame.face is not None:
            face = np.asarray(frame.face.landmarks, dtype=np.float32)
            row[FACE] = face[FACE_MESH_IDS]

        # ---- hands: 원본 손목 기하 매칭 → 마진 가드 → handedness fallback
        fa = _assign_hands(row, list(frame.hands), _raw_wrists(frame), prev_single_slot)
        if fa.single_slot is not None:
            prev_single_slot = fa.single_slot
        assignments.append(fa)

    return out, AssemblyMeta(assignments)
