"""/recognize 엔드포인트 검증 — 422 / 503 / 200."""

import numpy as np
import pytest

from app.core.config import settings
from app.ml import model as model_module
from app.ml.model import ModelState, get_model_state
from tests.conftest import make_frames, make_recognize_request

CHECKPOINT_AVAILABLE = model_module.resolve_checkpoint_path().exists()


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


def test_recognize_503_when_model_not_loaded(client, monkeypatch):
    monkeypatch.setattr(model_module, "_state", ModelState(loaded=False, error="test: not loaded"))
    res = client.post("/api/v1/recognize", json=make_recognize_request(make_frames()))
    assert res.status_code == 503
    assert "detail" in res.json()


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_200_real_inference(client):
    res = client.post("/api/v1/recognize", json=make_recognize_request(make_frames(n=40)))
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "req-1"
    assert data["status"] in {"recognized", "rejected"}
    assert data["model_version"] == "exp15_small_v2_z-off_f4"
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
    assert pp["used_frame_count"] == 40
    assert pp["preprocess_version"]


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_low_quality_no_hand(client):
    body = make_recognize_request(make_frames(n=20, with_hands=False))
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "low_quality"
    assert "no_hand_detected" in data["quality_issues"]
    assert data["candidates"] == []
    assert data["preprocess"] is None


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_shoulders_not_visible_is_advisory(client):
    """어깨 전무 세그먼트: 추론은 진행하고 shoulders_not_visible 을 참고용으로 첨부한다.

    normalize_signer 의 고정 fallback 이 동작하므로 차단하지 않는다 (한 손 사용 패턴 허용).
    """
    body = make_recognize_request(make_frames(n=20, with_pose=False))
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    assert "shoulders_not_visible" in data["quality_issues"]
    assert data["preprocess"] is not None


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_late_hand_entry_is_normal(client):
    """앞 절반 손 없음(손이 늦게 프레임에 들어옴): trim_rest 가 처리하는 정상 경로다."""
    frames = make_frames(n=40)
    for f in frames[:20]:
        f["hands"] = []
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    # 손이 프레임 밖에 있다가 들어온 것은 차단/어드바이저리 어느 쪽 이슈도 아니다
    assert "hand_partially_out" not in data["quality_issues"]
    assert "no_hand_detected" not in data["quality_issues"]
    pp = data["preprocess"]
    assert pp is not None
    assert pp["used_frame_count"] == 20  # 앞쪽 손 없는 구간이 트리밍됨


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_hand_partially_out_is_advisory(client):
    """트리밍 후 구간 중간에 손 결측이 많으면 hand_partially_out 을 참고용으로 첨부한다."""
    frames = make_frames(n=40)
    for f in frames[10:35]:  # 손 프레임 15/40 = 0.375 < 0.5, 15 >= MIN_TRIM_LEN(8)
        f["hands"] = []
    res = client.post("/api/v1/recognize", json=make_recognize_request(frames))
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in {"recognized", "rejected"}
    assert "hand_partially_out" in data["quality_issues"]
    assert data["preprocess"] is not None


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_checkpoint_loads():
    """체크포인트 로딩 스모크: dict wrapper 안의 state_dict 가 strict 로드돼야 한다."""
    state = get_model_state()
    assert state.loaded, f"model load failed: {state.error}"
    assert state.num_classes == 30
    assert state.model_name == "small"  # exp15 v2 z-off = small (d=128/4층)
    assert state.use_z is False  # z-off 체크포인트 — 전처리가 z 를 0 으로 고정해야 한다
    # 어휘 매핑 정본 = 내장 class_labels — vocab.py sorted 규약과 일치가 강제된다
    from app.ml.vocab import CLASS_INDEX_TO_ENTRY

    assert [e.label for e in state.class_entries] == [e.label for e in CLASS_INDEX_TO_ENTRY]
    # calibration.json 의 temperature 가 로드돼야 한다 (파일 부재 시에만 1.0)
    if model_module.resolve_calibration_path().exists():
        assert state.temperature != 1.0
    probs = state.predict_probs(np.zeros((32, 780), dtype=np.float32))
    assert probs.shape == (30,)
    np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-5)


# ---------------------------------------------------------------- 로드 거부 게이트
def _fake_checkpoint(**overrides) -> dict:
    """유효한 wrapper 를 기반으로 필드를 바꿔 로드 거부 조건을 만든다."""
    from app.ml.model import build_model
    from app.ml.vocab import CLASS_INDEX_TO_ENTRY

    ckpt = {
        "state_dict": build_model("small", 30).state_dict(),
        "model": "small",
        "num_classes": 30,
        "T": 32,
        "class_labels": [e.label for e in CLASS_INDEX_TO_ENTRY],
        "preprocess_version": "2",
        "use_z": True,
    }
    ckpt.update(overrides)
    return ckpt


def _load_fake(tmp_path, monkeypatch, ckpt: dict):
    import torch

    from app.core.config import settings as cfg

    path = tmp_path / "fake_ckpt" / "best.pt"
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, path)
    monkeypatch.setattr(cfg, "model_checkpoint_path", str(path))
    model_module.reset_model_state()
    try:
        return get_model_state()
    finally:
        model_module.reset_model_state()  # 다른 테스트가 진짜 체크포인트를 다시 로드하게


def test_load_refused_on_preprocess_version_mismatch(tmp_path, monkeypatch):
    """구모델(v1)+신전처리 조합 사고 방지 — preprocess_version 불일치면 로드 거부."""
    state = _load_fake(tmp_path, monkeypatch, _fake_checkpoint(preprocess_version="1"))
    assert not state.loaded
    assert "preprocess_version" in (state.error or "")


def test_load_refused_on_missing_preprocess_version(tmp_path, monkeypatch):
    """필드가 없는 구형(v1) 체크포인트는 "1" 로 간주해 거부한다."""
    ckpt = _fake_checkpoint()
    del ckpt["preprocess_version"]
    state = _load_fake(tmp_path, monkeypatch, ckpt)
    assert not state.loaded


def test_load_accepts_use_z_false(tmp_path, monkeypatch):
    """use_z=False 체크포인트는 수용하고 값이 상태에 실린다 (09 §3-1: 거부 → 분기)."""
    state = _load_fake(tmp_path, monkeypatch, _fake_checkpoint(use_z=False))
    assert state.loaded, f"model load failed: {state.error}"
    assert state.use_z is False


def test_load_accepts_use_z_true(tmp_path, monkeypatch):
    """use_z=True 체크포인트도 여전히 수용된다 — 분기는 값 기반이지 고정 아님."""
    state = _load_fake(tmp_path, monkeypatch, _fake_checkpoint(use_z=True))
    assert state.loaded, f"model load failed: {state.error}"
    assert state.use_z is True


def test_load_refused_on_missing_use_z(tmp_path, monkeypatch):
    """use_z 필드가 아예 없는 구형 체크포인트는 거부 — z 계약 불명 상태로 서빙 금지."""
    ckpt = _fake_checkpoint()
    del ckpt["use_z"]
    state = _load_fake(tmp_path, monkeypatch, ckpt)
    assert not state.loaded
    assert "use_z" in (state.error or "")


def test_load_refused_on_class_labels_mismatch(tmp_path, monkeypatch):
    """내장 class_labels 가 vocab.py sorted 규약과 어긋나면 로드 거부 — 조용한 전량 오답 방지."""
    ckpt = _fake_checkpoint()
    labels = list(ckpt["class_labels"])
    labels[0], labels[1] = labels[1], labels[0]  # 순서를 어긋나게
    ckpt["class_labels"] = labels
    state = _load_fake(tmp_path, monkeypatch, ckpt)
    assert not state.loaded
    assert "class_labels" in (state.error or "")


def test_load_refused_on_missing_class_labels(tmp_path, monkeypatch):
    ckpt = _fake_checkpoint()
    del ckpt["class_labels"]
    state = _load_fake(tmp_path, monkeypatch, ckpt)
    assert not state.loaded
    assert "class_labels" in (state.error or "")


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
