"""KSL 키포인트 레이아웃 상수 — 인터페이스 계약.

⚠️ 이 파일은 모델 레포(Ear-Dream-Model)의 `src/keypoint_layout.py`를 그대로 포팅한 것이다.
상수가 조금이라도 어긋나면 train/serve skew 가 생기므로 임의로 수정하지 말 것.
값 검증 테스트: tests/test_keypoint_layout.py

전체 130 키포인트 = 양손 42 + 상체 pose 10 + 얼굴 78.

인덱스 배치 (전역 인덱스, 0-based):
    LEFT_HAND  : 0..20    MediaPipe Hand 21 landmarks (왼손)
    RIGHT_HAND : 21..41   MediaPipe Hand 21 landmarks (오른손)
    POSE       : 42..51   상체 10점 (아래 상수 참조, NECK은 양어깨 중점 합성점)
    FACE       : 52..129  FaceMesh 78점 서브셋 (입술 40 + 눈썹 10 + 눈 24 + 코 4)

FLIP_PERM: 좌우 미러 증강 시 사용하는 길이 130 permutation.
    (서빙에서는 증강을 쓰지 않지만 레이아웃 검증을 위해 원본 그대로 유지한다.)
"""

import numpy as np

# ---------------------------------------------------------------- 블록 경계
N_KP = 130

LEFT_HAND = list(range(21))  # 0..20
RIGHT_HAND = list(range(21, 42))  # 21..41
POSE = list(range(42, 52))  # 42..51
FACE = list(range(52, 130))  # 52..129

HAND_N = 21

# ------------------------------------------------------------- POSE 상세
# MediaPipe Pose 원본 인덱스 → 전역 인덱스 매핑.
# NECK은 MediaPipe에 없는 합성점(양어깨 중점)으로, assembly.py에서 계산한다.
NOSE = 42  # pose 0
NECK = 43  # 합성: (left_shoulder + right_shoulder) / 2
L_SHOULDER = 44  # pose 11
R_SHOULDER = 45  # pose 12
L_ELBOW = 46  # pose 13
R_ELBOW = 47  # pose 14
L_WRIST = 48  # pose 15
R_WRIST = 49  # pose 16
L_HIP = 50  # pose 23
R_HIP = 51  # pose 24

# MediaPipe pose 결과에서 뽑아올 원본 landmark 인덱스 (NECK 제외)
POSE_MP_IDS = {
    NOSE: 0,
    L_SHOULDER: 11,
    R_SHOULDER: 12,
    L_ELBOW: 13,
    R_ELBOW: 14,
    L_WRIST: 15,
    R_WRIST: 16,
    L_HIP: 23,
    R_HIP: 24,
}

_POSE_LR_PAIRS = [
    (L_SHOULDER, R_SHOULDER),
    (L_ELBOW, R_ELBOW),
    (L_WRIST, R_WRIST),
    (L_HIP, R_HIP),
]
_POSE_MIDLINE = [NOSE, NECK]

# ------------------------------------------------------------- FACE 상세
# MediaPipe FaceMesh(468) 서브셋 78점. 좌우 대칭 쌍(pair) + 정중선(midline)으로 구성.
# 아래 튜플은 (subject-left mesh id, subject-right mesh id).
# KSL 비수지 신호(입모양·눈썹 등)를 위해 입술을 가장 조밀하게 유지한다.

# 입술 외곽 20점: 9쌍 + 정중선 2 (0=윗입술 중앙, 17=아랫입술 중앙)
_LIPS_OUTER_PAIRS = [
    (291, 61),
    (375, 146),
    (321, 91),
    (405, 181),
    (314, 84),
    (409, 185),
    (270, 40),
    (269, 39),
    (267, 37),
]
_LIPS_OUTER_MID = [0, 17]

# 입술 안쪽 20점: 9쌍 + 정중선 2 (13=윗입술 안쪽 중앙, 14=아랫입술 안쪽 중앙)
_LIPS_INNER_PAIRS = [
    (308, 78),
    (324, 95),
    (318, 88),
    (402, 178),
    (317, 87),
    (415, 191),
    (310, 80),
    (311, 81),
    (312, 82),
]
_LIPS_INNER_MID = [13, 14]

# 눈썹 10점: 5쌍 (안쪽→바깥쪽)
_BROW_PAIRS = [
    (336, 107),
    (296, 66),
    (334, 105),
    (293, 63),
    (300, 70),
]

# 눈 24점: 눈당 12점 × 좌우 = 12쌍 (눈꺼풀 상/하 + 안/바깥 눈꼬리)
_EYE_PAIRS = [
    (263, 33),
    (362, 133),  # 바깥/안쪽 눈꼬리
    (386, 159),
    (374, 145),  # 상/하 중앙
    (385, 158),
    (380, 153),
    (387, 160),
    (373, 144),  # 상/하 중간점
    (384, 157),
    (381, 154),
    (398, 173),
    (382, 155),  # 안쪽 근처 상/하
]

# 코 4점: 정중선 2 (1=코끝, 168=콧대) + 콧볼 1쌍
_NOSE_PAIRS = [(327, 98)]
_NOSE_MID = [1, 168]

# FACE 서브셋의 FaceMesh id 나열 순서 (전역 52..129 에 대응)
_FACE_PAIRS = _LIPS_OUTER_PAIRS + _LIPS_INNER_PAIRS + _BROW_PAIRS + _EYE_PAIRS + _NOSE_PAIRS  # 36쌍
_FACE_MID = _LIPS_OUTER_MID + _LIPS_INNER_MID + _NOSE_MID  # 6점

FACE_MESH_IDS: list[int] = []
for _l, _r in _FACE_PAIRS:
    FACE_MESH_IDS.extend([_l, _r])
FACE_MESH_IDS.extend(_FACE_MID)

assert len(FACE_MESH_IDS) == 78, f"FACE must be 78 points, got {len(FACE_MESH_IDS)}"
assert len(set(FACE_MESH_IDS)) == 78, "FACE mesh ids must be unique"


# ------------------------------------------------------------- FLIP_PERM
def _build_flip_perm() -> np.ndarray:
    perm = np.arange(N_KP)

    # 1) 양손 블록 스왑: 왼손 landmark i ↔ 오른손 landmark i
    for i in range(HAND_N):
        perm[LEFT_HAND[i]] = RIGHT_HAND[i]
        perm[RIGHT_HAND[i]] = LEFT_HAND[i]

    # 2) pose 좌우 쌍 스왑 (정중선 NOSE/NECK은 그대로)
    for left, right in _POSE_LR_PAIRS:
        perm[left], perm[right] = right, left

    # 3) 얼굴 좌우 대칭 쌍 스왑
    mesh_to_global = {mid: FACE[k] for k, mid in enumerate(FACE_MESH_IDS)}
    for lm, rm in _FACE_PAIRS:
        gl, gr = mesh_to_global[lm], mesh_to_global[rm]
        perm[gl], perm[gr] = gr, gl
    # 정중선 얼굴 점은 자기 자신 (이미 항등)

    return perm


FLIP_PERM: np.ndarray = _build_flip_perm()

assert np.array_equal(FLIP_PERM[FLIP_PERM], np.arange(N_KP)), "FLIP_PERM must be an involution"

# ------------------------------------------------------------- 손가락 그룹
# (증강 전용이지만 레이아웃 정본과의 diff 를 없애기 위해 유지)
FINGER_GROUPS_LOCAL = {
    "thumb": [1, 2, 3, 4],
    "index": [5, 6, 7, 8],
    "middle": [9, 10, 11, 12],
    "ring": [13, 14, 15, 16],
    "pinky": [17, 18, 19, 20],
}

N_CH = 3  # (x, y, z)
FEAT_DIM = N_KP * N_CH * 2  # 위치 390 + 속도 390 = 780
