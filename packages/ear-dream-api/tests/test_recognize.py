"""/recognize 엔드포인트 검증 — 422 / 503 / 200 (SPOTER-208 번들 서빙)."""

import numpy as np
import pytest

from app.core.config import settings
from app.ml import model as model_module
from app.ml.model import ModelState, get_model_state
from tests.conftest import make_frames, make_recognize_request

BUNDLE_AVAILABLE = (model_module.resolve_bundle_dir() / "release.json").exists()


def test_recognize_422_too_few_frames(client):
    body = make_recognize_request(make_frames(n=settings.min_frames - 1))
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 422


def test_recognize_422_bad_hand_point_count(client):
    frames = make_frames(n=12)
    frames[0]["hands"][0]["landmarks"] = frames[0]["hands"][0]["landmarks"][:20]  # 21 → 20점
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 422


def test_recognize_422_non_monotonic_t_ms(client):
    frames = make_frames(n=12)
    frames[5]["t_ms"] = frames[4]["t_ms"]  # 단조증가 위반
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 422


def test_recognize_422_face_468_points(client):
    """468점(홍채 미포함) 메쉬는 SPOTER face 37 인덱스(468·473 포함)를 만들 수 없어
    스키마 단계에서 422 로 명확히 거절한다 (config.face_point_counts=[478] 주석)."""
    frames = make_frames(n=12)
    frames[0]["face"] = {"landmarks": [[0.5, 0.5, 0.0]] * 468}
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 422


def test_recognize_503_when_model_not_loaded(client, monkeypatch):
    monkeypatch.setattr(model_module, "_state", ModelState(loaded=False, error="test: not loaded"))
    res = client.post("/api/v1/recognize", json=make_recognize_request(make_frames()))
    assert res.status_code == 503
    assert "detail" in res.json()


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_200_real_inference(client):
    res = client.post("/api/v1/recognize", json=make_recognize_request(make_frames(n=40)))
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "req-1"
    assert data["status"] in {"recognized", "rejected"}
    assert data["model_version"] == "spoter300-pilot"
    if data["status"] == "recognized":
        assert 1 <= len(data["candidates"]) <= settings.recognize_top_k
        confidences = [c["confidence"] for c in data["candidates"]]
        assert confidences == sorted(confidences, reverse=True)
        for c in data["candidates"]:
            assert c["id"].startswith("w_")
    else:
        assert data["candidates"] == []
    pp = data["preprocess"]
    assert pp is not None
    # 30fps 리샘플 후 모델 입력 프레임 수 (트리밍 없음 — 전 구간 사용)
    assert 1 <= pp["used_frame_count"] <= 256
    assert pp["used_start_ms"] == 0.0
    assert pp["interpolated_frame_count"] == 0  # spoter 계약: 보간 없음
    assert pp["preprocess_version"] == "spoter2_mp_xy_v1"


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_low_quality_no_hand(client):
    body = make_recognize_request(make_frames(n=20, with_hands=False))
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "low_quality"
    assert "no_hand_detected" in data["quality_issues"]
    assert data["candidates"] == []
    assert data["preprocess"] is None


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_shoulders_not_visible_is_advisory(client):
    """어깨 전무 세그먼트: 추론은 진행하고 shoulders_not_visible 을 참고용으로 첨부한다.

    pose 부위는 0-채움되지만 손 local 특징만으로 추론은 가능하다 (차단하지 않는다).
    """
    body = make_recognize_request(make_frames(n=20, with_pose=False))
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    assert "shoulders_not_visible" in data["quality_issues"]
    assert data["preprocess"] is not None


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_late_hand_entry_is_normal(client):
    """앞 절반 손 없음(손이 늦게 프레임에 들어옴): 손 프레임 비율 50% 는 정상 경로다.

    SPOTER 전처리는 트리밍이 없다 — 결측 구간은 0-채움으로 모델 입력에 남는다.
    """
    frames = make_frames(n=40)
    for f in frames[:20]:
        f["hands"] = []
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    # 손 비율 정확히 0.5 — advisory 임계(< 0.5) 미발동
    assert "hand_partially_out" not in data["quality_issues"]
    assert "no_hand_detected" not in data["quality_issues"]
    assert data["preprocess"] is not None


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_hand_partially_out_is_advisory(client):
    """세그먼트 내 손 결측이 많으면 hand_partially_out 을 참고용으로 첨부한다."""
    frames = make_frames(n=40)
    for f in frames[10:35]:  # 손 프레임 15/40 = 0.375 < 0.5, 15 >= min_frames(8)
        f["hands"] = []
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    assert "hand_partially_out" in data["quality_issues"]
    assert data["preprocess"] is not None


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_bundle_loads():
    """번들 로딩 스모크: release.json 게이트 통과 + TorchScript 추론이 확률을 내야 한다."""
    state = get_model_state()
    assert state.loaded, f"model load failed: {state.error}"
    assert state.num_classes == 300
    assert state.model_name == "spoter_208"
    assert state.model_version == "spoter300-pilot"
    # release.json class_labels 는 vocab300.json 인덱스 순서와 일치가 강제된다
    from app.ml.vocab import CLASS_INDEX_TO_ENTRY

    assert [e.label for e in state.class_entries] == [e.label for e in CLASS_INDEX_TO_ENTRY]
    assert state.temperature != 1.0  # calibration temperature (1.8489...)
    assert 0.0 < state.reject_threshold < 1.0
    probs = state.predict_probs(np.zeros((32, 208), dtype=np.float32))
    assert probs.shape == (300,)
    np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-5)


def test_recognize_archives_request_body(client, tmp_path):
    """아카이빙: 검증 실패(422) 요청도 저장되어야 한다."""
    body = make_recognize_request(make_frames(n=2), request_id="req-archive")  # 프레임 부족 → 422
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 422
    # 네이밍 규칙: {MMDD_HHMM}_{sess8}/{seq:03d}_{req8}.json.gz — req8 은 앞 8자 "req-arch"
    archived = list(
        (settings.package_root / settings.archive_dir).glob("*_sess-1/001_req-arch.json.gz")
    )
    assert len(archived) == 1
