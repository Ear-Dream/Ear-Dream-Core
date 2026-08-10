"""요청 프레임(LandmarkFrame 시퀀스) → 모델 키포인트 배열 (T, 130, 3) 조립.

결측은 전부 NaN 으로 둔다 — 결측치 대치(보간)는 preprocess.interpolate_nan 한 곳에서만
수행한다(설계 결정 1).

손 좌우 배정 규칙:
  1순위 — 포즈 손목 기하 매칭: MediaPipe pose 15(왼 손목)/16(오른 손목)과 각 손의
          landmark 0(손목) 사이 xy 거리를 비교해 가까운 쪽 슬롯에 배정한다.
          두 손이 있으면 (h0→L, h1→R) vs (h0→R, h1→L) 중 거리 합이 최소인 배정을 쓴다.
  2순위 — 포즈(양 손목)가 결측이면 handedness 라벨 fallback:
          "Left"→LEFT_HAND, "Right"→RIGHT_HAND.
          ⚠️ 앱의 handedness 라벨은 아직 실측 검증 전이다(HANDEDNESS_VERIFIED=false).
          서버는 받은 라벨을 그대로 믿는다 — 라벨 의미가 뒤집히면 앱 쪽에서 고친다.
          두 손이 같은 슬롯을 다투면 score 가 높은 손이 라벨 슬롯을 갖고
          나머지는 남는 슬롯으로 보낸다.

포즈 33점 → 10점 서브셋 + NECK(양어깨 중점) 합성. visibility < 임계(서버 설정)인
점은 NaN 처리한다.

얼굴 468/478점 → FACE_MESH_IDS 78점 서브셋 (모든 id < 468 이라 양쪽 호환).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

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


def _xy_dist(a: Sequence[float], b: np.ndarray) -> float:
    return math.hypot(a[0] - float(b[0]), a[1] - float(b[1]))


def _write_hand(out: np.ndarray, hand: HandObservation, slot: list[int]) -> None:
    out[slot, :] = np.asarray(hand.landmarks, dtype=np.float32)[:HAND_N]


def _slot_by_label(hand: HandObservation) -> list[int]:
    return LEFT_HAND if hand.handedness_label.lower() == "left" else RIGHT_HAND


def _assign_hands(out: np.ndarray, hands: list[HandObservation]) -> None:
    """out 에 포즈 손목이 이미 채워진 상태에서 손 블록을 배정·기록한다."""
    if not hands:
        return
    lw, rw = out[L_WRIST], out[R_WRIST]
    wrists_ok = not (np.isnan(lw[:2]).any() or np.isnan(rw[:2]).any())

    if len(hands) == 1:
        hand = hands[0]
        if wrists_ok:
            w = hand.landmarks[0]
            slot = LEFT_HAND if _xy_dist(w, lw) <= _xy_dist(w, rw) else RIGHT_HAND
        else:
            slot = _slot_by_label(hand)
        _write_hand(out, hand, slot)
        return

    h0, h1 = hands[0], hands[1]
    if wrists_ok:
        # 거리 합이 최소가 되는 배정 (2×2 라 두 경우만 비교)
        d_straight = _xy_dist(h0.landmarks[0], lw) + _xy_dist(h1.landmarks[0], rw)
        d_swapped = _xy_dist(h0.landmarks[0], rw) + _xy_dist(h1.landmarks[0], lw)
        if d_straight <= d_swapped:
            _write_hand(out, h0, LEFT_HAND)
            _write_hand(out, h1, RIGHT_HAND)
        else:
            _write_hand(out, h0, RIGHT_HAND)
            _write_hand(out, h1, LEFT_HAND)
        return

    # handedness fallback
    s0, s1 = _slot_by_label(h0), _slot_by_label(h1)
    if s0 is s1:
        # 같은 슬롯을 다투면 score 가 높은 손이 라벨 슬롯 차지
        winner, loser = (h0, h1) if h0.handedness_score >= h1.handedness_score else (h1, h0)
        other = RIGHT_HAND if s0 is LEFT_HAND else LEFT_HAND
        _write_hand(out, winner, s0)
        _write_hand(out, loser, other)
    else:
        _write_hand(out, h0, s0)
        _write_hand(out, h1, s1)


def assemble_frames(
    frames: Sequence[LandmarkFrame],
    pose_visibility_threshold: float,
) -> np.ndarray:
    """LandmarkFrame 시퀀스 → (T, 130, 3) float32, 결측 NaN."""
    out = np.full((len(frames), N_KP, 3), np.nan, dtype=np.float32)

    for t, frame in enumerate(frames):
        row = out[t]

        # ---- pose: 33점 → 10점 서브셋 (visibility 임계 미달은 NaN 유지)
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

        # ---- hands: 포즈 손목 기하 매칭 → handedness fallback
        _assign_hands(row, list(frame.hands))

    return out
