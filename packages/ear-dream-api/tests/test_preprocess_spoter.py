"""spoter2_mp_xy_v1 전처리 검증 — 레퍼런스 구현(preprocess_one_video.py)과 수치 대조.

아래 `ref_*` 는 레퍼런스 구현의 xy/normalize_pose/normalize_local/process/FACE_INDICES 를
**인라인 복사**한 것이다 (정본과의 수치 일치가 이 테스트의 존재 이유 — 수정 금지).
동일한 좌표를 레퍼런스의 raw dict 형식과 서버의 LandmarkFrame 형식으로 각각 만들어
[T, 208] features 와 part_mask 가 정확히 일치하는지 본다.
"""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from app.ml.assembly import assemble_frames
from app.ml.preprocess_spoter import (
    AR_TRAIN,
    FACE_INDICES,
    FEAT_DIM,
    MAX_MODEL_FRAMES,
    PREPROCESS_VERSION,
    preprocess_spoter,
    resample_indices_30fps,
    uniform_sample_indices,
)
from app.schemas.landmark import FaceObservation, LandmarkFrame

THRESHOLD = 0.5
FPS30_STEP = 1000.0 / 30.0

# ---------------------------------------------------------------- 레퍼런스 인라인 복사
REF_FACE_INDICES = [
    0, 4, 13, 14, 17, 33, 39, 46, 52, 55, 61, 64, 81,
    93, 133, 151, 152, 159, 172, 178, 181, 263, 269, 276,
    282, 285, 291, 294, 311, 323, 362, 386, 397, 402, 405,
    468, 473,
]  # fmt: skip


def ref_xy(items: list[dict], indices) -> np.ndarray:
    return np.asarray([[items[i]["x"], items[i]["y"]] for i in indices], dtype=np.float32)


def ref_normalize_pose(points: np.ndarray, eps: float = 1e-6) -> np.ndarray | None:
    center = (points[11] + points[12]) / 2.0
    shoulder_distance = float(np.linalg.norm(points[11] - points[12]))
    if not np.isfinite(shoulder_distance) or shoulder_distance <= eps:
        return None
    return (points - center) / (1.5 * shoulder_distance)


def ref_normalize_local(
    points: np.ndarray, padding: float = 0.2, eps: float = 1e-6
) -> np.ndarray | None:
    low, high = points.min(axis=0), points.max(axis=0)
    side = float(np.max(high - low))
    if not np.isfinite(side) or side <= eps:
        return None
    center = (low + high) / 2.0
    return (points - center) / (side * (0.5 + padding))


def ref_process(raw: dict) -> tuple[np.ndarray, np.ndarray]:
    frames = raw["frames"]
    features = np.zeros((len(frames), 208), dtype=np.float32)
    mask = np.zeros((len(frames), 4), dtype=np.uint8)
    specs = (
        ("pose", range(25), 50, ref_normalize_pose),
        ("right_hand", range(21), 42, ref_normalize_local),
        ("left_hand", range(21), 42, ref_normalize_local),
        ("face", REF_FACE_INDICES, 74, ref_normalize_local),
    )
    for row, frame in enumerate(frames):
        offset = 0
        for part_index, (name, indices, width, normalizer) in enumerate(specs):
            item = frame[name]
            if item.get("detected") and item.get("landmarks"):
                points = normalizer(ref_xy(item["landmarks"], indices))
                if points is not None and np.all(np.isfinite(points)):
                    features[row, offset : offset + width] = points.reshape(-1)
                    mask[row, part_index] = 1
            offset += width
    return features, mask


# ---------------------------------------------------------------- 합성 데이터 빌더
POSE_LW, POSE_RW = (0.7, 0.8), (0.3, 0.8)  # 포즈 손목 — 손 배정 기하 매칭 기준점


def _points(rng: np.random.Generator, n: int, center=(0.5, 0.5), spread=0.05) -> list[list[float]]:
    pts = rng.uniform(-spread, spread, size=(n, 3))
    pts[:, 0] += center[0]
    pts[:, 1] += center[1]
    return pts.tolist()


def _pose33(rng: np.random.Generator) -> list[list[float]]:
    pts = _points(rng, 33, center=(0.5, 0.5), spread=0.15)
    pts[11] = [0.6, 0.5, 0.0]  # left shoulder
    pts[12] = [0.4, 0.5, 0.0]  # right shoulder
    pts[15] = [*POSE_LW, 0.0]  # left wrist
    pts[16] = [*POSE_RW, 0.0]  # right wrist
    return pts


def make_paired_frames(
    n: int = 12,
    *,
    with_pose=True,
    with_right=True,
    with_left=True,
    with_face=True,
    t_step_ms: float = FPS30_STEP,
) -> tuple[list[LandmarkFrame], dict]:
    """같은 좌표로 (서버 LandmarkFrame 리스트, 레퍼런스 raw dict) 쌍을 만든다.

    손은 포즈 손목 위에 배치해 assembly 기하 배정이 레퍼런스의 명시적 슬롯과 일치한다.
    """
    server_frames: list[LandmarkFrame] = []
    raw_frames: list[dict] = []
    for t in range(n):
        rng = np.random.default_rng(1000 + t)
        pose = _pose33(rng)
        right = _points(rng, 21, center=POSE_RW)
        right[0] = [*POSE_RW, 0.0]  # landmark 0 = 손목 (기하 매칭 기준)
        left = _points(rng, 21, center=POSE_LW)
        left[0] = [*POSE_LW, 0.0]
        face = _points(rng, 478, center=(0.5, 0.3), spread=0.1)

        hands = []
        if with_right:
            hands.append({"handedness_label": "Right", "handedness_score": 0.9, "landmarks": right})
        if with_left:
            hands.append({"handedness_label": "Left", "handedness_score": 0.9, "landmarks": left})
        server_frames.append(
            LandmarkFrame.model_validate(
                {
                    "t_ms": t * t_step_ms,
                    "hands": hands,
                    "face": {"landmarks": face} if with_face else None,
                    "pose": {"landmarks": pose, "visibility": [1.0] * 33} if with_pose else None,
                }
            )
        )
        raw_frames.append(
            {
                "frame_index": t,
                "timestamp_ms": t * t_step_ms,
                "pose": {"detected": with_pose, "landmarks": _to_ref(pose) if with_pose else None},
                "right_hand": {
                    "detected": with_right,
                    "landmarks": _to_ref(right) if with_right else None,
                },
                "left_hand": {
                    "detected": with_left,
                    "landmarks": _to_ref(left) if with_left else None,
                },
                "face": {"detected": with_face, "landmarks": _to_ref(face) if with_face else None},
            }
        )
    return server_frames, {"frames": raw_frames}


def _to_ref(points: list[list[float]]) -> list[dict]:
    return [{"x": p[0], "y": p[1], "z": p[2]} for p in points]


def _run_server(frames: list[LandmarkFrame], aspect: float = AR_TRAIN, y_scale: float = 1.0):
    """기본 aspect 16/9(AR 배율 1.0)·y_scale 1.0 은 둘 다 항등 — 레퍼런스 대조 테스트는
    보정 없는 레퍼런스 구현과 비트 단위 일치해야 하므로 항등으로 돌린다."""
    kp, _meta = assemble_frames(frames, THRESHOLD)
    return preprocess_spoter(frames, kp, source_aspect=aspect, y_scale=y_scale)


# ---------------------------------------------------------------- 레퍼런스 대조
def test_version():
    assert PREPROCESS_VERSION == "spoter2_mp_xy_v1"
    assert FACE_INDICES == REF_FACE_INDICES


def test_reference_parity_full_detection():
    """전 부위 검출 세그먼트: 서버 [T,208] == 레퍼런스 process() 결과 (30fps 입력 =
    리샘플 항등)."""
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames)
    ref_features, ref_mask = ref_process(raw)
    assert out.x.shape == (12, FEAT_DIM)
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)
    assert out.part_mask.all()  # 전 부위 검출


@pytest.mark.parametrize(
    "kwargs",
    [
        {"with_face": False},
        {"with_pose": False},
        {"with_left": False},
        {"with_right": False, "with_face": False},
    ],
)
def test_reference_parity_missing_parts(kwargs):
    """부위 미검출: 해당 폭 0-채움 + part_mask 0 — 레퍼런스와 동일해야 한다."""
    server_frames, raw = make_paired_frames(n=10, **kwargs)
    out = _run_server(server_frames)
    ref_features, ref_mask = ref_process(raw)
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)


def test_degenerate_hand_bbox_is_masked():
    """한 손의 21점이 전부 같은 점이면 bbox side=0 → 정규화 불가 → 0-채움 + mask 0.

    레퍼런스 normalize_local 의 side<=eps 경로와 동일해야 한다.
    """
    server_frames, raw = make_paired_frames(n=8)
    degenerate = [[*POSE_RW, 0.0]] * 21
    for t in (2, 3):
        # 오른손을 퇴화 bbox 로 교체 (양쪽 표현 동일하게)
        obs = server_frames[t].hands[0]
        assert obs.handedness_label == "Right"
        server_frames[t] = server_frames[t].model_copy(
            update={
                "hands": [
                    obs.model_copy(update={"landmarks": degenerate}),
                    server_frames[t].hands[1],
                ]
            }
        )
        raw["frames"][t]["right_hand"]["landmarks"] = _to_ref(degenerate)
    out = _run_server(server_frames)
    ref_features, ref_mask = ref_process(raw)
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)
    assert out.part_mask[2, 1] == 0  # right_hand 미검출 처리
    np.testing.assert_array_equal(out.x[2, 50:92], np.zeros(42, dtype=np.float32))


# ---------------------------------------------------------------- 기하 보정 (AR x + y)
def _scale_raw(raw: dict, x_scale: float = 1.0, y_scale: float = 1.0) -> dict:
    """레퍼런스 raw dict 의 모든 부위 x·y 를 서버와 동일한 float32 곱으로 스케일한다.

    서버는 float32 좌표에 float32 배율을 곱하므로(preprocess_spoter._frame_features),
    기대값도 같은 연산으로 만들어야 비트 단위 대조가 성립한다. 이 변환은 live_eval
    러너의 실험 구현(원시 좌표 전 부위 y×s 후 전처리)과 같은 수식이다 — 서버 내장
    y_scale 이 러너 결과와 일치하는지의 대조가 여기서 성립한다."""
    sx, sy = np.float32(x_scale), np.float32(y_scale)
    out_frames = []
    for frame in raw["frames"]:
        new_frame = dict(frame)
        for part in ("pose", "right_hand", "left_hand", "face"):
            item = frame[part]
            if item.get("landmarks"):
                new_frame[part] = {
                    **item,
                    "landmarks": [
                        {
                            **p,
                            "x": float(np.float32(p["x"]) * sx),
                            "y": float(np.float32(p["y"]) * sy),
                        }
                        for p in item["landmarks"]
                    ],
                }
        out_frames.append(new_frame)
    return {"frames": out_frames}


def test_ar_identity_at_train_aspect():
    """AR_live == AR_TRAIN(16:9)이면 배율이 정확히 1.0(항등) — 보정 없는 레퍼런스와
    비트 단위 동일해야 한다. 1920/1080 같은 실측 16:9 해상도도 같은 배율이다."""
    assert 1920 / 1080 == AR_TRAIN
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames, aspect=1920 / 1080)
    assert out.x_scale == 1.0
    assert out.source_aspect == AR_TRAIN
    ref_features, ref_mask = ref_process(raw)
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)


def test_ar_vertical_matches_x_scaled_reference():
    """세로(9:16) 입력: 서버 출력 == "x 만 배율만큼 스케일한 원시 좌표"로 돌린 레퍼런스.

    보정이 정규화 이전 원시 x 에만, 모든 부위(pose·양손·face)에 일괄 적용됨을 검증한다."""
    aspect = 9.0 / 16.0
    scale = aspect / AR_TRAIN  # ≈ 0.3164 (세로 캡처)
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames, aspect=aspect)
    assert out.x_scale == pytest.approx(scale)
    ref_features, ref_mask = ref_process(_scale_raw(raw, x_scale=scale))
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)
    # 항등 배율 결과와는 달라야 한다 — 보정이 실제로 걸렸는지 확인 (y 는 불변이지만
    # global/local 정규화가 x 스케일에 의존하므로 특징값이 달라진다)
    baseline = _run_server(server_frames, aspect=AR_TRAIN)
    assert not np.array_equal(out.x, baseline.x)


def test_y_scale_one_is_identity():
    """y_scale == 1.0 이면 완전 항등 — 기본값(레퍼런스 대조 경로)과 비트 단위 동일하고
    보정 없는 레퍼런스와도 일치한다 (config.live_y_scale=1.0 이 보정 끔이 되는 근거)."""
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames, aspect=AR_TRAIN, y_scale=1.0)
    assert out.y_scale == 1.0
    ref_features, ref_mask = ref_process(raw)
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)


def test_y_scale_matches_y_scaled_reference():
    """y_scale=1.205 (서빙 기본값): 서버 출력 == "전 부위 y 를 배율만큼 스케일한 원시
    좌표"로 돌린 레퍼런스. 이 변환이 live_eval 러너 실험 구현(전 부위 y×s 후 전처리)과
    같은 수식이므로, 서버 내장 경로가 검증된 러너 결과와 일치함을 수치로 대조한다."""
    from app.core.config import settings

    y = settings.live_y_scale  # 1.205 — 임시값 (config.py 주석)
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames, aspect=AR_TRAIN, y_scale=y)
    assert out.y_scale == pytest.approx(y)
    ref_features, ref_mask = ref_process(_scale_raw(raw, y_scale=y))
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)
    # 항등 결과와 달라야 한다 — y 보정이 실제로 걸렸는지 (고정 상수라 16:9 에도 비항등)
    baseline = _run_server(server_frames, aspect=AR_TRAIN)
    assert not np.array_equal(out.x, baseline.x)


def test_ar_and_y_scale_compose():
    """세로 입력 + y 보정 동시 적용 (서빙 실경로): x·y 배율을 함께 건 레퍼런스와 일치."""
    from app.core.config import settings

    aspect = 9.0 / 16.0
    y = settings.live_y_scale
    server_frames, raw = make_paired_frames(n=12)
    out = _run_server(server_frames, aspect=aspect, y_scale=y)
    ref_features, ref_mask = ref_process(_scale_raw(raw, x_scale=aspect / AR_TRAIN, y_scale=y))
    np.testing.assert_array_equal(out.x, ref_features)
    np.testing.assert_array_equal(out.part_mask, ref_mask)


# ---------------------------------------------------------------- 시간축
def test_resample_identity_at_30fps():
    t_ms = np.arange(20, dtype=np.float64) * FPS30_STEP
    np.testing.assert_array_equal(resample_indices_30fps(t_ms), np.arange(20))


def test_resample_upsamples_low_fps():
    """15fps 입력은 30fps 그리드에서 프레임이 약 2배로 복제된다 (최근접 선택 —
    좌표 보간 없음)."""
    t_ms = np.arange(10, dtype=np.float64) * (1000.0 / 15.0)
    sel = resample_indices_30fps(t_ms)
    # duration 600ms → floor(600/33.33)+1 = 19 프레임
    assert len(sel) == 19
    assert sel[0] == 0 and sel[-1] == 9
    assert (np.diff(sel) >= 0).all()  # 시간 순서 보존
    # 각 소스 프레임이 최소 1회 이상 등장 (삭제 없음)
    assert set(sel.tolist()) == set(range(10))


def test_resample_nearest_selection():
    """불균일 t_ms: 각 그리드 시점에서 가장 가까운 프레임이 뽑혀야 한다."""
    t_ms = np.array([0.0, 30.0, 70.0, 100.0])
    sel = resample_indices_30fps(t_ms)
    # grid = [0, 33.33, 66.67, 100.0] → 최근접 [0, 1, 2, 3]
    np.testing.assert_array_equal(sel, [0, 1, 2, 3])


def test_uniform_sample_matches_training_loader():
    """256 초과 uniform sampling 은 학습 데이터로더(SignH5Dataset)의
    np.linspace(...).round() 와 동일해야 한다 (train/serve 일치)."""
    expected = np.linspace(0, 299, MAX_MODEL_FRAMES).round().astype(np.int64)
    np.testing.assert_array_equal(uniform_sample_indices(300), expected)
    np.testing.assert_array_equal(uniform_sample_indices(256), np.arange(256))
    np.testing.assert_array_equal(uniform_sample_indices(10), np.arange(10))


def test_long_low_fps_segment_capped_at_256():
    """저 fps 장 세그먼트: 30fps 리샘플로 늘었다가 256 으로 캡된다."""
    # 150 프레임 @ 10fps = 15초 → 30fps 그리드 ~450 프레임 → 256 캡
    server_frames, _ = make_paired_frames(n=150, t_step_ms=100.0)
    out = _run_server(server_frames)
    assert out.source_frame_count == 150
    assert out.resampled_frame_count == 448  # floor(149*100/33.33)+1
    assert out.model_frame_count == MAX_MODEL_FRAMES
    assert out.x.shape == (MAX_MODEL_FRAMES, FEAT_DIM)


# ---------------------------------------------------------------- 얼굴 478 계약
def test_face_468_rejected_by_schema():
    """468점 메쉬는 스키마가 422 로 거른다 (FACE_INDICES 의 468·473 홍채 필요)."""
    with pytest.raises(ValidationError):
        FaceObservation.model_validate({"landmarks": [[0.5, 0.5, 0.0]] * 468})


def test_face_468_defensively_demoted():
    """스키마 우회 경로 방어: 478 이 아닌 얼굴은 미검출과 동일하게 강등된다."""
    server_frames, _ = make_paired_frames(n=8)
    bad_face = FaceObservation.model_construct(landmarks=[[0.5, 0.5, 0.0]] * 468)
    server_frames[0] = server_frames[0].model_copy(update={"face": bad_face})
    out = _run_server(server_frames)
    assert out.part_mask[0, 3] == 0
    np.testing.assert_array_equal(out.x[0, 134:208], np.zeros(74, dtype=np.float32))
    assert out.part_mask[1:, 3].all()  # 다른 프레임은 정상


def test_output_dtype_and_nan_free():
    server_frames, _ = make_paired_frames(n=12)
    out = _run_server(server_frames)
    assert out.x.dtype == np.float32
    assert np.isfinite(out.x).all()
    rates = out.part_detection_rates
    assert rates == {"pose": 1.0, "right_hand": 1.0, "left_hand": 1.0, "face": 1.0}
