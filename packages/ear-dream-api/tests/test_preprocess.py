"""전처리 eval 경로 검증 — 모델 레포 tests/test_normalization.py·test_isotropic.py 의
성질을 재현한다 (정본: 모델 레포 src/dataset.py 의 v2 구현)."""

import numpy as np

from app.ml import preprocess as pp
from app.ml.keypoint_layout import FEAT_DIM, L_SHOULDER, N_KP, R_SHOULDER


def make_synthetic_sample(
    T_raw: int = 60, seed: int = 0, nan_rate: float = 0.0, shoulder_width: float = 0.3
) -> np.ndarray:
    """모델 레포 dataset.make_synthetic_sample 과 동일 구성의 합성 샘플."""
    rng = np.random.default_rng(seed)
    kp = rng.uniform(0.2, 0.8, size=(T_raw, N_KP, 3)).astype(np.float32)
    kp[:, :, 2] = rng.uniform(-0.1, 0.1, size=(T_raw, N_KP))
    kp[:, L_SHOULDER, :] = (0.5 + shoulder_width / 2, 0.5, 0.0)
    kp[:, R_SHOULDER, :] = (0.5 - shoulder_width / 2, 0.5, 0.0)
    if nan_rate > 0:
        m = rng.random((T_raw, N_KP)) < nan_rate
        kp[m] = np.nan
    return kp


def _project(phys: np.ndarray, ar: float) -> np.ndarray:
    """물리 좌표(높이=1 단위, x∈[0, AR]) → AR 프레임 MediaPipe 정규화 좌표.

    모델 레포 tests/test_isotropic.py 의 _project 와 동일.
    """
    out = phys.astype(np.float64).copy()
    out[:, :, 0] = phys[:, :, 0] / ar
    return out.astype(np.float32)


def _physical_motion(T: int = 40, seed: int = 0) -> np.ndarray:
    """세로 프레임(폭 9/16)에도 들어가는 물리 좌표 동작 (test_isotropic.py 와 동일)."""
    rng = np.random.default_rng(seed)
    phys = rng.uniform(0.1, 0.5, size=(T, N_KP, 3))
    phys[:, :, 1] = rng.uniform(0.2, 0.8, size=(T, N_KP))
    phys[:, :, 2] = rng.uniform(-0.1, 0.1, size=(T, N_KP))
    phys[:, L_SHOULDER, :] = (0.4, 0.4, 0.0)
    phys[:, R_SHOULDER, :] = (0.2, 0.4, 0.0)
    return phys


def test_preprocess_version_is_2():
    assert pp.PREPROCESS_VERSION == "2"


def test_isotropic_invariance_across_aspect_ratios():
    """핵심 불변성: 같은 물리 동작 → 16:9와 9:16에서 동일한 정규화 출력."""
    phys = _physical_motion()
    a = pp.normalize_signer(_project(phys, 16 / 9), aspect_ratio=16 / 9)
    b = pp.normalize_signer(_project(phys, 9 / 16), aspect_ratio=9 / 16)
    np.testing.assert_allclose(a, b, atol=2e-3)


def test_v2_shoulder_width_one_and_origin():
    """v2 에서도 어깨 너비=1, 어깨 중점=원점 유지 (등방 공간 기준)."""
    for ar in (16 / 9, 9 / 16, 1.0):
        kp = _project(_physical_motion(seed=int(ar * 100)), ar)
        out = pp.normalize_signer(kp, aspect_ratio=ar)
        width = np.linalg.norm(out[:, L_SHOULDER, :2] - out[:, R_SHOULDER, :2], axis=1)
        center = (out[:, L_SHOULDER, :] + out[:, R_SHOULDER, :]) / 2.0
        np.testing.assert_allclose(width, 1.0, atol=1e-4, err_msg=f"AR={ar}")
        np.testing.assert_allclose(center, 0.0, atol=1e-4, err_msg=f"AR={ar}")


def test_v1_path_preserved():
    """aspect_ratio=None(v1)은 픽셀 비율 복원을 하지 않는다 — AR=1.0 과 동일."""
    kp = make_synthetic_sample(T_raw=30, seed=5)
    v1 = pp.normalize_signer(kp)
    ar1 = pp.normalize_signer(kp, aspect_ratio=1.0)
    np.testing.assert_allclose(v1, ar1, atol=1e-6)


def test_normalize_signer_no_shoulder_fallback():
    """어깨 전무 극단 케이스: 프레임 중앙 fallback — 중심 (0.5·AR, 0.5, 0), scale 0.25."""
    ar = 9 / 16
    kp = make_synthetic_sample()
    kp[:, [L_SHOULDER, R_SHOULDER], :] = np.nan
    out = pp.normalize_signer(kp, aspect_ratio=ar)
    assert not np.isnan(out[:, 0, :]).any()

    # fallback 수치 검증: 알려진 입력점의 정규화 결과가 수식과 일치해야 한다
    probe = kp[0, 0, :]  # NaN 아님 (어깨만 지웠다)
    expected_x = (probe[0] * ar - 0.5 * ar) / 0.25
    expected_y = (probe[1] - 0.5) / 0.25
    np.testing.assert_allclose(out[0, 0, 0], expected_x, atol=1e-5)
    np.testing.assert_allclose(out[0, 0, 1], expected_y, atol=1e-5)


def test_trim_rest_bounds_matches_slice():
    kp = make_synthetic_sample(T_raw=50)
    kp[:5] = np.nan  # leading rest (양손 미검출)
    kp[-7:] = np.nan  # trailing rest
    start, end = pp.trim_rest_bounds(kp)
    assert (start, end) == (5, 43)
    assert pp.trim_rest(kp).shape[0] == 38


def test_preprocess_eval_shape_and_nan_free():
    kp = make_synthetic_sample(T_raw=60, nan_rate=0.1)
    out = pp.preprocess_eval(kp, aspect_ratio=9 / 16, use_z=True)
    assert out.x.shape == (pp.TARGET_T, FEAT_DIM)
    assert out.x.dtype == np.float32
    assert not np.isnan(out.x).any()
    assert out.used_frame_count == 60
    assert out.interpolated_frame_count > 0


def test_preprocess_eval_aspect_ratio_changes_output():
    """AR 이 다르면 같은 정규화 좌표 입력이라도 모델 입력이 달라야 한다 (등방 복원 효과)."""
    kp = make_synthetic_sample(T_raw=40, seed=3)
    a = pp.preprocess_eval(kp, aspect_ratio=16 / 9, use_z=True)
    b = pp.preprocess_eval(kp, aspect_ratio=9 / 16, use_z=True)
    assert not np.allclose(a.x, b.x)


# ---------------------------------------------------------------- use_z 분기 (핸드오프 09 §3-2)
def _split_pos_vel_z(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(T, 780) → (위치 z (T, 130), 속도 z (T, 130))."""
    pos = x[:, : N_KP * 3].reshape(-1, N_KP, 3)
    vel = x[:, N_KP * 3 :].reshape(-1, N_KP, 3)
    return pos[:, :, 2], vel[:, :, 2]


def test_zero_z_preserves_nan_pattern():
    """zero_z 는 z 만 0 으로 바꾸고 NaN 위치는 그대로 둔다 — trim/보간 규약 유지."""
    kp = make_synthetic_sample(T_raw=30, nan_rate=0.2, seed=7)
    out = pp.zero_z(kp)
    np.testing.assert_array_equal(np.isnan(out), np.isnan(kp))  # NaN 패턴 동일
    z = out[:, :, 2]
    assert np.all((z == 0.0) | np.isnan(z))  # NaN 아닌 z 는 전부 0
    np.testing.assert_array_equal(out[:, :, :2], kp[:, :, :2])  # x·y 는 무변경


def test_preprocess_eval_use_z_false_zeroes_position_and_velocity():
    """use_z=False: 위치·속도 z 전부 0, shape (32, 780) 유지 — 채널 제거 아님."""
    kp = make_synthetic_sample(T_raw=60, nan_rate=0.1, seed=1)
    out = pp.preprocess_eval(kp, aspect_ratio=9 / 16, use_z=False)
    assert out.x.shape == (pp.TARGET_T, FEAT_DIM)  # 780 유지
    pos_z, vel_z = _split_pos_vel_z(out.x)
    np.testing.assert_array_equal(pos_z, 0.0)
    np.testing.assert_array_equal(vel_z, 0.0)
    # x·y 경로는 use_z 와 무관하게 동일해야 한다 (zero_z 는 z 에만 작용)
    on = pp.preprocess_eval(kp, aspect_ratio=9 / 16, use_z=True)
    keep = np.ones(FEAT_DIM, dtype=bool)
    keep[2::3] = False  # 위치·속도 블록 모두 (…, x, y, z) 반복이라 z 는 3 배수 오프셋 2
    np.testing.assert_allclose(out.x[:, keep], on.x[:, keep], atol=0.0)
    assert not np.allclose(on.x, out.x)  # use_z=True 는 z 를 실제로 쓴다 (분기 실효성)


def test_preprocess_eval_use_z_false_ignores_input_z():
    """입력 z 값이 무엇이든(Swagger 예시처럼 z 가 실려 있어도) 결과가 같아야 한다."""
    kp = make_synthetic_sample(T_raw=40, seed=2)
    perturbed = kp.copy()
    perturbed[:, :, 2] = np.float32(-1.91)  # Core 실측 pose z 평균 수준의 교란
    a = pp.preprocess_eval(kp, aspect_ratio=9 / 16, use_z=False)
    b = pp.preprocess_eval(perturbed, aspect_ratio=9 / 16, use_z=False)
    np.testing.assert_array_equal(a.x, b.x)
