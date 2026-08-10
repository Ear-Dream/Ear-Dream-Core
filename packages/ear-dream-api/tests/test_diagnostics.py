"""진단 로깅(app/services/diagnostics) 검증 — /recognize 처리마다 레코드가 남는지."""

import json

import pytest

from app.core.config import settings
from app.ml import model as model_module
from tests.conftest import make_frames, make_recognize_request

CHECKPOINT_AVAILABLE = model_module.resolve_checkpoint_path().exists()


def _read_record(tmp_path, session_id: str, request_id: str) -> dict:
    # 네이밍 규칙: {MMDD_HHMM}_{sess8}/{seq:03d}_{req8}_{status}[_{top1라벨}].json
    pattern = f"*_{session_id[:8]}/[0-9][0-9][0-9]_{request_id[:8]}_*.json"
    matches = list((tmp_path / "diagnostics").glob(pattern))
    assert len(matches) == 1, f"diagnostics record not written: {pattern} -> {matches}"
    return json.loads(matches[0].read_text(encoding="utf-8"))


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_recognize_writes_diagnostics_record(client, tmp_path):
    res = client.post(
        "/api/v1/recognize", json=make_recognize_request(make_frames(n=40), request_id="diag-1")
    )
    assert res.status_code == 200

    record = _read_record(tmp_path, "sess-1", "diag-1")
    assert record["schema"] == "recognize-diagnostics-v1"
    assert record["request"]["frame_count"] == 40
    assert record["request"]["source_width"] == 720
    assert record["assembly"]["hands_per_frame"]["1"] == 40
    # conftest 프레임은 포즈 손목이 항상 유효하다 → 전 프레임 기하 매칭
    assert record["assembly"]["hand_slot_assignment"]["geometry_frames"] == 40
    assert record["assembly"]["hand_slot_assignment"]["label_fallback_frames"] == 0
    assert record["preprocess"]["trim"]["used_frame_count"] == 40
    # v2 등방 정규화: scale 은 픽셀 비율 복원(x ← x×AR) 후 어깨 너비다.
    # conftest: 어깨 너비 0.3 (x 축), AR = 720/1280 = 0.5625 → 0.3 × 0.5625
    assert record["preprocess"]["normalization"]["aspect_ratio"] == pytest.approx(720 / 1280)
    assert record["preprocess"]["normalization"]["shoulder_width_scale"] == pytest.approx(
        0.3 * (720 / 1280)
    )
    # use_z 반영 (핸드오프 09 §3): z-off 모델이면 z 통계가 모델이 실제로 본 값(0)이어야 한다
    from app.ml.model import get_model_state

    use_z = get_model_state().use_z
    assert record["preprocess"]["normalization"]["use_z"] is use_z
    hand_z = record["preprocess"]["normalization"]["post_norm"]["hand_z"]
    if not use_z:
        assert hand_z == {"min": 0.0, "mean": 0.0, "max": 0.0}

    # 모델 원시 출력: 30 클래스 전체 softmax, 내림차순, 합≈1
    softmax = record["model_output"]["softmax"]
    assert len(softmax) == 30
    probs = [e["prob"] for e in softmax]
    assert probs == sorted(probs, reverse=True)
    assert sum(probs) == pytest.approx(1.0, abs=1e-4)

    assert record["response"]["status"] == res.json()["status"]
    assert record["response"]["reject_threshold"] == settings.reject_threshold
    assert record["response"]["temperature"] is not None  # calibration.json 의 temperature
    assert record["response"]["latency_ms"] is not None


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_low_quality_record_has_no_model_output(client, tmp_path):
    body = make_recognize_request(make_frames(n=20, with_hands=False), request_id="diag-lq")
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    assert res.json()["status"] == "low_quality"

    record = _read_record(tmp_path, "sess-1", "diag-lq")
    assert record["model_output"] is None
    assert record["preprocess"] is None
    assert "no_hand_detected" in record["response"]["quality_issues"]


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model checkpoint not available")
def test_diagnostics_disabled_writes_nothing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "diagnostics_enabled", False)
    res = client.post(
        "/api/v1/recognize", json=make_recognize_request(make_frames(n=20), request_id="diag-off")
    )
    assert res.status_code == 200
    assert not (tmp_path / "diagnostics").exists()
