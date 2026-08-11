"""SPOTER-208 번들 로더(app/ml/model.py) 게이트 검증 — 가짜 번들로 거부 조건을 만든다.

실제 45MB TorchScript 대신 동일 시그니처(features, padding_mask) → (B, 300) 로짓의
소형 스크립트 모듈을 번들에 넣는다 — 게이트는 release.json 검증이 핵심이라 가중치
크기와 무관하다.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

from app.ml import model as model_module
from app.ml.model import get_model_state
from app.ml.preprocess_spoter import FEAT_DIM, PREPROCESS_VERSION
from app.ml.vocab import CLASS_INDEX_TO_ENTRY


class _StubSpoter(torch.nn.Module):
    """TorchScript 시그니처만 흉내 내는 스텁 — logits 는 클래스 0 이 항상 최고가 되게."""

    def forward(self, features: torch.Tensor, padding_mask: torch.Tensor) -> torch.Tensor:
        batch = features.shape[0]
        logits = torch.zeros(batch, 300)
        logits[:, 0] = 5.0
        return logits


def _valid_release(**overrides) -> dict:
    release = {
        "bundle": "fake-bundle",
        "feature_version": PREPROCESS_VERSION,
        "model_name": "spoter_208",
        "num_classes": 300,
        "class_labels": [e.label for e in CLASS_INDEX_TO_ENTRY],
        "serving": {
            "artifact": "model_torchscript.pt",
            "temperature": 2.0,
            "recommended_reject_threshold": 0.5,
        },
    }
    release.update(overrides)
    return release


def _write_bundle(tmp_path: Path, release: dict) -> Path:
    bundle = tmp_path / "fake-bundle"
    bundle.mkdir(parents=True, exist_ok=True)
    torch.jit.save(torch.jit.script(_StubSpoter()), str(bundle / "model_torchscript.pt"))
    (bundle / "release.json").write_text(json.dumps(release, ensure_ascii=False), encoding="utf-8")
    return bundle


def _load(tmp_path, monkeypatch, release: dict):
    from app.core.config import settings as cfg

    bundle = _write_bundle(tmp_path, release)
    monkeypatch.setattr(cfg, "model_bundle_dir", str(bundle))
    model_module.reset_model_state()
    try:
        return get_model_state()
    finally:
        model_module.reset_model_state()  # 다른 테스트가 진짜 번들을 다시 로드하게


def test_valid_fake_bundle_loads_and_predicts(tmp_path, monkeypatch):
    state = _load(tmp_path, monkeypatch, _valid_release())
    assert state.loaded, f"load failed: {state.error}"
    assert state.model_version == "fake-bundle"
    assert state.temperature == 2.0
    assert state.reject_threshold == 0.5
    probs = state.predict_probs(np.zeros((16, FEAT_DIM), dtype=np.float32))
    assert probs.shape == (300,)
    assert int(np.argmax(probs)) == 0  # 스텁 로짓의 클래스 0
    np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-5)


def test_load_refused_on_feature_version_mismatch(tmp_path, monkeypatch):
    """전처리 계약(feature_version) 불일치면 로드 거부 — train/serve skew 방지."""
    state = _load(tmp_path, monkeypatch, _valid_release(feature_version="2"))
    assert not state.loaded
    assert "feature_version" in (state.error or "")


def test_load_refused_on_num_classes_mismatch(tmp_path, monkeypatch):
    state = _load(tmp_path, monkeypatch, _valid_release(num_classes=30))
    assert not state.loaded
    assert "num_classes" in (state.error or "")


def test_load_refused_on_class_labels_length_mismatch(tmp_path, monkeypatch):
    labels = [e.label for e in CLASS_INDEX_TO_ENTRY][:299]
    state = _load(tmp_path, monkeypatch, _valid_release(class_labels=labels))
    assert not state.loaded
    assert "class_labels" in (state.error or "")


def test_load_refused_on_class_labels_order_mismatch(tmp_path, monkeypatch):
    """class_labels 순서가 어휘 데이터와 어긋나면 로드 거부 — 조용한 전량 오답 방지."""
    labels = [e.label for e in CLASS_INDEX_TO_ENTRY]
    labels[0], labels[1] = labels[1], labels[0]
    state = _load(tmp_path, monkeypatch, _valid_release(class_labels=labels))
    assert not state.loaded
    assert "class_labels" in (state.error or "")


def test_load_refused_on_missing_class_labels(tmp_path, monkeypatch):
    release = _valid_release()
    del release["class_labels"]
    state = _load(tmp_path, monkeypatch, release)
    assert not state.loaded
    assert "class_labels" in (state.error or "")


def test_load_fails_gracefully_on_missing_bundle(tmp_path, monkeypatch):
    """번들 디렉토리가 없으면 loaded=False — 서버는 뜨되 /recognize 503 시맨틱."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "model_bundle_dir", str(tmp_path / "nonexistent"))
    model_module.reset_model_state()
    try:
        state = get_model_state()
    finally:
        model_module.reset_model_state()
    assert not state.loaded
    assert state.error


def test_settings_override_beats_release_threshold(tmp_path, monkeypatch):
    """reject 임계: settings.reject_threshold(float) > release.json 권장값."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "reject_threshold", 0.7)
    state = _load(tmp_path, monkeypatch, _valid_release())
    assert state.loaded
    assert state.reject_threshold == 0.7


def test_fallback_threshold_when_release_has_none(tmp_path, monkeypatch):
    release = _valid_release()
    del release["serving"]["recommended_reject_threshold"]
    state = _load(tmp_path, monkeypatch, release)
    assert state.loaded
    assert state.reject_threshold == model_module.FALLBACK_REJECT_THRESHOLD
