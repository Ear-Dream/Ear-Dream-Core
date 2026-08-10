"""keypoint_layout 포팅 값 검증 — 모델 레포 정본과 어긋나면 train/serve skew."""

import numpy as np

from app.ml import keypoint_layout as kl


def test_block_boundaries():
    assert kl.N_KP == 130
    assert kl.LEFT_HAND == list(range(21))
    assert kl.RIGHT_HAND == list(range(21, 42))
    assert kl.POSE == list(range(42, 52))
    assert kl.FACE == list(range(52, 130))
    assert kl.HAND_N == 21
    assert kl.FEAT_DIM == 780


def test_pose_indices():
    assert (kl.NOSE, kl.NECK) == (42, 43)
    assert (kl.L_SHOULDER, kl.R_SHOULDER) == (44, 45)
    assert (kl.L_WRIST, kl.R_WRIST) == (48, 49)
    # NECK(합성점)은 MediaPipe 원본 매핑에 없어야 한다
    assert kl.NECK not in kl.POSE_MP_IDS
    assert kl.POSE_MP_IDS == {
        42: 0,
        44: 11,
        45: 12,
        46: 13,
        47: 14,
        48: 15,
        49: 16,
        50: 23,
        51: 24,
    }


def test_face_mesh_ids():
    assert len(kl.FACE_MESH_IDS) == 78
    assert len(set(kl.FACE_MESH_IDS)) == 78  # 중복 0
    # 468 구성에서도 유효해야 478 메쉬와 양쪽 호환된다
    assert all(0 <= mid < 468 for mid in kl.FACE_MESH_IDS)
    # 나열 순서 스폿 체크: 첫 쌍(입술 외곽)과 끝(정중선 코)
    assert kl.FACE_MESH_IDS[:2] == [291, 61]
    assert kl.FACE_MESH_IDS[-6:] == [0, 17, 13, 14, 1, 168]


def test_flip_perm_involution():
    assert np.array_equal(kl.FLIP_PERM[kl.FLIP_PERM], np.arange(kl.N_KP))
    # 손 블록 스왑 확인
    assert kl.FLIP_PERM[0] == 21
    assert kl.FLIP_PERM[21] == 0
    # 정중선 pose 점은 항등
    assert kl.FLIP_PERM[kl.NOSE] == kl.NOSE
    assert kl.FLIP_PERM[kl.NECK] == kl.NECK
