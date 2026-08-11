"""진단 로깅(app/services/diagnostics) 검증 — /recognize 처리마다 레코드가 남는지."""

import json

import pytest

from app.core.config import settings
from app.ml import model as model_module
from tests.conftest import make_frames, make_recognize_request

BUNDLE_AVAILABLE = (model_module.resolve_bundle_dir() / "release.json").exists()


def _read_record(tmp_path, session_id: str, request_id: str) -> dict:
    # 네이밍 규칙: {MMDD_HHMM}_{sess8}/{seq:03d}_{req8}_{status}[_{top1라벨}].json
    pattern = f"*_{session_id[:8]}/[0-9][0-9][0-9]_{request_id[:8]}_*.json"
    matches = list((tmp_path / "diagnostics").glob(pattern))
    assert len(matches) == 1, f"diagnostics record not written: {pattern} -> {matches}"
    return json.loads(matches[0].read_text(encoding="utf-8"))


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_recognize_writes_diagnostics_record(client, tmp_path):
    res = client.post(
        "/api/v1/recognize", json=make_recognize_request(make_frames(n=40), request_id="diag-1")
    )
    assert res.status_code == 200

    record = _read_record(tmp_path, "sess-1", "diag-1")
    assert record["schema"] == "recognize-diagnostics-v3"
    assert record["request"]["frame_count"] == 40
    assert record["request"]["source_width"] == 720
    assert record["assembly"]["hands_per_frame"]["1"] == 40
    # conftest 프레임은 포즈 손목이 항상 유효 + 마진이 크다 → 전 프레임 기하 배정
    # (배정 메타는 assembly.AssemblyMeta.summary() 그대로 — stash v2.6 포팅)
    assignment = record["assembly"]["hand_slot_assignment"]
    assert assignment["paths"] == {"geometry": 40}
    assert assignment["geometry_label_mismatch_frames"] == 0
    assert assignment["single_hand_slot_transitions"] == 0

    # spoter 전처리 요약: 리샘플·부위 검출율·정규화 후 범위
    pre = record["preprocess"]
    assert pre["resample"]["source_frame_count"] == 40
    assert 1 <= pre["resample"]["model_frame_count"] <= 256
    assert pre["part_detection_rates"]["pose"] == 1.0
    assert pre["part_detection_rates"]["right_hand"] == 1.0
    assert pre["part_detection_rates"]["face"] == 0.0  # conftest 프레임은 face 없음
    # local 정규화된 손 특징은 정상 검출 시 [-1, 1] 범위가 기대값 (계약 §15.2)
    hands_stats = pre["post_norm"]["hands"]
    assert -1.0 <= hands_stats["min"] and hands_stats["max"] <= 1.0

    # 모델 원시 출력: softmax 상위 10 (300 전체는 파일만 불린다), 내림차순
    mo = record["model_output"]
    assert mo["num_classes"] == 300
    softmax = mo["softmax_top"]
    assert len(softmax) == 10
    probs = [e["prob"] for e in softmax]
    assert probs == sorted(probs, reverse=True)

    assert record["response"]["status"] == res.json()["status"]
    # reject 임계는 로드 시 확정값 (release.json 권장값 또는 설정 오버라이드)
    from app.ml.model import get_model_state

    assert record["response"]["reject_threshold"] == get_model_state().reject_threshold
    assert record["response"]["temperature"] is not None  # release.json 의 temperature
    assert record["response"]["latency_ms"] is not None


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_low_quality_record_has_no_model_output(client, tmp_path):
    body = make_recognize_request(make_frames(n=20, with_hands=False), request_id="diag-lq")
    res = client.post("/api/v1/recognize", json=body)
    assert res.status_code == 200
    assert res.json()["status"] == "low_quality"

    record = _read_record(tmp_path, "sess-1", "diag-lq")
    assert record["model_output"] is None
    assert record["preprocess"] is None
    assert "no_hand_detected" in record["response"]["quality_issues"]


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_diagnostics_disabled_writes_nothing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "diagnostics_enabled", False)
    res = client.post(
        "/api/v1/recognize", json=make_recognize_request(make_frames(n=20), request_id="diag-off")
    )
    assert res.status_code == 200
    assert not (tmp_path / "diagnostics").exists()
