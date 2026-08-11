"""assembly 검증 — 손 좌우 배정(기하/가드/handedness), 배정 메타, NECK 합성, 얼굴 서브셋.

배정 기준점(원본 포즈 손목 좌표)과 모델 입력 마스킹(visibility 임계)의 분리가 핵심이다 —
저 visibility 손목 케이스가 이를 검증한다.
"""

import numpy as np

from app.ml.assembly import (
    PATH_CONTINUITY,
    PATH_FALLBACK_MARGIN,
    PATH_FALLBACK_POSE_NULL,
    PATH_GEOMETRY,
    PATH_NO_HANDS,
    assemble_frames,
)
from app.ml.keypoint_layout import (
    FACE,
    FACE_MESH_IDS,
    L_SHOULDER,
    L_WRIST,
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
    kp, meta = assemble_frames([frame], THRESHOLD)
    assert not np.isnan(kp[0, RIGHT_HAND, :]).any()
    assert np.isnan(kp[0, LEFT_HAND, :]).all()
    assert meta.frames[0].path == PATH_GEOMETRY
    assert meta.frames[0].label_mismatch is True  # 기하가 라벨을 이겼다 = 라벨 노이즈 관측


def test_low_visibility_wrist_still_assigned_by_geometry():
    # 배정 기준점과 모델 입력 마스킹의 분리: 왼 손목 visibility 가 임계 미달이어도
    # 배정은 원본 좌표로 기하 매칭한다 (세로 셀피에서 쉬는 손이 프레임 밖인 실사용 케이스).
    pose = make_pose()
    pose["visibility"][15] = 0.1  # 왼 손목 저vis — 종전 로직이면 라벨 fallback 행
    hand = make_hand((0.3, 0.8), label="Left")  # 라벨 노이즈, 좌표는 오른 손목 위
    kp, meta = assemble_frames([frame_of(pose=pose, hands=[hand])], THRESHOLD)
    # 모델 입력 마스킹은 그대로: 저vis 왼 손목 포즈 점은 NaN
    assert np.isnan(kp[0, L_WRIST]).all()
    # 배정은 기하 — 라벨("Left")이 아니라 좌표가 이긴다
    assert meta.frames[0].path == PATH_GEOMETRY
    assert not np.isnan(kp[0, RIGHT_HAND, :]).any()
    assert np.isnan(kp[0, LEFT_HAND, :]).all()


def test_two_hands_min_total_distance():
    near_left = make_hand((0.7, 0.8), label="Right")  # pose 왼 손목 근처 (라벨은 반대)
    near_right = make_hand((0.3, 0.8), label="Right")
    frame = frame_of(pose=make_pose(), hands=[near_right, near_left])
    kp, meta = assemble_frames([frame], THRESHOLD)
    np.testing.assert_allclose(kp[0, LEFT_HAND[0], :2], [0.7, 0.8], atol=1e-6)
    np.testing.assert_allclose(kp[0, RIGHT_HAND[0], :2], [0.3, 0.8], atol=1e-6)
    assert meta.frames[0].path == PATH_GEOMETRY
    assert meta.frames[0].label_mismatch is True  # near_left 가 라벨 Right 인데 LEFT 슬롯


def test_handedness_fallback_without_pose():
    frame = frame_of(hands=[make_hand((0.5, 0.5), label="Left")])
    kp, meta = assemble_frames([frame], THRESHOLD)
    assert not np.isnan(kp[0, LEFT_HAND, :]).any()
    assert np.isnan(kp[0, RIGHT_HAND, :]).all()
    assert meta.frames[0].path == PATH_FALLBACK_POSE_NULL


def test_handedness_fallback_same_slot_conflict():
    h_strong = make_hand((0.2, 0.2), label="Left")
    h_strong["handedness_score"] = 0.95
    h_weak = make_hand((0.8, 0.8), label="Left")
    h_weak["handedness_score"] = 0.4
    frame = frame_of(hands=[h_weak, h_strong])
    kp, meta = assemble_frames([frame], THRESHOLD)
    # score 높은 손이 라벨 슬롯(LEFT), 나머지는 남는 슬롯(RIGHT)
    np.testing.assert_allclose(kp[0, LEFT_HAND[0], :2], [0.2, 0.2], atol=1e-6)
    np.testing.assert_allclose(kp[0, RIGHT_HAND[0], :2], [0.8, 0.8], atol=1e-6)
    assert meta.frames[0].path == PATH_FALLBACK_POSE_NULL


def test_margin_guard_uses_previous_slot_continuity():
    # 프레임 1: 명확한 기하 → LEFT 슬롯. 프레임 2: 두 손목이 같은 자리(마진 0) + 라벨
    # 노이즈("Right") — 연속성 가드가 궤적 분열을 막고 LEFT 를 유지해야 한다.
    ambiguous_pose = make_pose()
    ambiguous_pose["landmarks"][15] = [0.5, 0.8, 0.0]
    ambiguous_pose["landmarks"][16] = [0.5, 0.8, 0.0]
    frames = [
        frame_of(pose=make_pose(), hands=[make_hand((0.7, 0.8), label="Left")]),
        frame_of(pose=ambiguous_pose, hands=[make_hand((0.5, 0.8), label="Right")]),
    ]
    kp, meta = assemble_frames(frames, THRESHOLD)
    assert meta.frames[0].path == PATH_GEOMETRY
    assert meta.frames[1].path == PATH_CONTINUITY
    assert not np.isnan(kp[1, LEFT_HAND, :]).any()
    assert np.isnan(kp[1, RIGHT_HAND, :]).all()
    assert meta.summary()["single_hand_slot_transitions"] == 0


def test_margin_guard_without_history_falls_back_to_label():
    ambiguous_pose = make_pose()
    ambiguous_pose["landmarks"][15] = [0.5, 0.8, 0.0]
    ambiguous_pose["landmarks"][16] = [0.5, 0.8, 0.0]
    frame = frame_of(pose=ambiguous_pose, hands=[make_hand((0.5, 0.8), label="Right")])
    kp, meta = assemble_frames([frame], THRESHOLD)
    assert meta.frames[0].path == PATH_FALLBACK_MARGIN
    assert not np.isnan(kp[0, RIGHT_HAND, :]).any()


def test_meta_summary_counts_paths_and_transitions():
    frames = [
        frame_of(),  # no_hands
        frame_of(pose=make_pose(), hands=[make_hand((0.3, 0.8), label="Right")]),  # geometry R
        frame_of(hands=[make_hand((0.7, 0.8), label="Left")]),  # pose_null → L (전환 1회)
        frame_of(pose=make_pose(), hands=[make_hand((0.7, 0.8), label="Left")]),  # geometry L
    ]
    _, meta = assemble_frames(frames, THRESHOLD)
    summary = meta.summary()
    assert summary["paths"] == {
        PATH_NO_HANDS: 1,
        PATH_GEOMETRY: 2,
        PATH_FALLBACK_POSE_NULL: 1,
    }
    assert summary["geometry_label_mismatch_frames"] == 0
    # R → L(fallback) → L : 전환 1회 (라벨 노이즈였다면 이 값이 궤적 분열 지표가 된다)
    assert summary["single_hand_slot_transitions"] == 1


def test_neck_synthesis_and_visibility_threshold():
    pose = make_pose(shoulder_width=0.3)
    frame = frame_of(pose=pose)
    kp, _ = assemble_frames([frame], THRESHOLD)
    expected_neck = (np.array(pose["landmarks"][11]) + np.array(pose["landmarks"][12])) / 2.0
    np.testing.assert_allclose(kp[0, NECK], expected_neck, atol=1e-6)

    # 한쪽 어깨 visibility 미달 → 그 점과 NECK 이 NaN
    pose2 = make_pose(shoulder_width=0.3)
    pose2["visibility"][11] = 0.1
    kp2, _ = assemble_frames([frame_of(pose=pose2)], THRESHOLD)
    assert np.isnan(kp2[0, L_SHOULDER]).all()
    assert not np.isnan(kp2[0, R_SHOULDER]).any()
    assert np.isnan(kp2[0, NECK]).all()


def test_face_subset():
    n_points = 478
    face_landmarks = [[i / 1000.0, i / 2000.0, 0.0] for i in range(n_points)]
    frame = frame_of(face={"landmarks": face_landmarks})
    kp, _ = assemble_frames([frame], THRESHOLD)
    for k, mesh_id in enumerate(FACE_MESH_IDS):
        np.testing.assert_allclose(kp[0, FACE[k]], face_landmarks[mesh_id], atol=1e-6)


def test_missing_everything_is_nan():
    kp, meta = assemble_frames([frame_of()], THRESHOLD)
    assert np.isnan(kp).all()
    assert meta.frames[0].path == PATH_NO_HANDS
