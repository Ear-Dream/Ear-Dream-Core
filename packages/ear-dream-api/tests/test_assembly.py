"""assembly 검증 — 손 좌우 배정(기하/handedness), NECK 합성, 얼굴 서브셋, visibility."""

import numpy as np

from app.ml.assembly import assemble_frames
from app.ml.keypoint_layout import (
    FACE,
    FACE_MESH_IDS,
    L_SHOULDER,
    LEFT_HAND,
    NECK,
    R_SHOULDER,
    RIGHT_HAND,
)
from app.schemas.landmark import LandmarkFrame
from tests.conftest import make_hand, make_pose

THRESHOLD = 0.5


def frame_of(**kw) -> LandmarkFrame:
    base = {"t_ms": 0.0, "hands": [], "face": None, "pose": None}
    base.update(kw)
    return LandmarkFrame.model_validate(base)


def test_geometric_assignment_beats_handedness_label():
    # 라벨은 "Left"지만 pose 오른 손목(0.3, 0.8)에 가까움 → RIGHT_HAND 슬롯
    hand = make_hand((0.3, 0.8), label="Left")
    frame = frame_of(pose=make_pose(), hands=[hand])
    kp = assemble_frames([frame], THRESHOLD)
    assert not np.isnan(kp[0, RIGHT_HAND, :]).any()
    assert np.isnan(kp[0, LEFT_HAND, :]).all()


def test_two_hands_min_total_distance():
    near_left = make_hand((0.7, 0.8), label="Right")  # pose 왼 손목 근처 (라벨은 반대)
    near_right = make_hand((0.3, 0.8), label="Right")
    frame = frame_of(pose=make_pose(), hands=[near_right, near_left])
    kp = assemble_frames([frame], THRESHOLD)
    np.testing.assert_allclose(kp[0, LEFT_HAND[0], :2], [0.7, 0.8], atol=1e-6)
    np.testing.assert_allclose(kp[0, RIGHT_HAND[0], :2], [0.3, 0.8], atol=1e-6)


def test_handedness_fallback_without_pose():
    frame = frame_of(hands=[make_hand((0.5, 0.5), label="Left")])
    kp = assemble_frames([frame], THRESHOLD)
    assert not np.isnan(kp[0, LEFT_HAND, :]).any()
    assert np.isnan(kp[0, RIGHT_HAND, :]).all()


def test_handedness_fallback_same_slot_conflict():
    h_strong = make_hand((0.2, 0.2), label="Left")
    h_strong["handedness_score"] = 0.95
    h_weak = make_hand((0.8, 0.8), label="Left")
    h_weak["handedness_score"] = 0.4
    frame = frame_of(hands=[h_weak, h_strong])
    kp = assemble_frames([frame], THRESHOLD)
    # score 높은 손이 라벨 슬롯(LEFT), 나머지는 남는 슬롯(RIGHT)
    np.testing.assert_allclose(kp[0, LEFT_HAND[0], :2], [0.2, 0.2], atol=1e-6)
    np.testing.assert_allclose(kp[0, RIGHT_HAND[0], :2], [0.8, 0.8], atol=1e-6)


def test_neck_synthesis_and_visibility_threshold():
    pose = make_pose(shoulder_width=0.3)
    frame = frame_of(pose=pose)
    kp = assemble_frames([frame], THRESHOLD)
    expected_neck = (np.array(pose["landmarks"][11]) + np.array(pose["landmarks"][12])) / 2.0
    np.testing.assert_allclose(kp[0, NECK], expected_neck, atol=1e-6)

    # 한쪽 어깨 visibility 미달 → 그 점과 NECK 이 NaN
    pose2 = make_pose(shoulder_width=0.3)
    pose2["visibility"][11] = 0.1
    kp2 = assemble_frames([frame_of(pose=pose2)], THRESHOLD)
    assert np.isnan(kp2[0, L_SHOULDER]).all()
    assert not np.isnan(kp2[0, R_SHOULDER]).any()
    assert np.isnan(kp2[0, NECK]).all()


def test_face_subset():
    n_points = 478
    face_landmarks = [[i / 1000.0, i / 2000.0, 0.0] for i in range(n_points)]
    frame = frame_of(face={"landmarks": face_landmarks})
    kp = assemble_frames([frame], THRESHOLD)
    for k, mesh_id in enumerate(FACE_MESH_IDS):
        np.testing.assert_allclose(kp[0, FACE[k]], face_landmarks[mesh_id], atol=1e-6)


def test_missing_everything_is_nan():
    kp = assemble_frames([frame_of()], THRESHOLD)
    assert np.isnan(kp).all()
