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


def _write_bundle(tmp_path: Path, release: dict, debias: np.ndarray | None = None) -> Path:
    bundle = tmp_path / "fake-bundle"
    bundle.mkdir(parents=True, exist_ok=True)
    torch.jit.save(torch.jit.script(_StubSpoter()), str(bundle / "model_torchscript.pt"))
    (bundle / "release.json").write_text(json.dumps(release, ensure_ascii=False), encoding="utf-8")
    if debias is not None:
        np.save(bundle / model_module.DEBIAS_FILENAME, debias)
    return bundle


def _load(tmp_path, monkeypatch, release: dict, debias: np.ndarray | None = None):
    from app.core.config import settings as cfg

    bundle = _write_bundle(tmp_path, release, debias=debias)
    monkeypatch.setattr(cfg, "model_bundle_dir", str(bundle))
    model_module.reset_model_state()
    try:
        return get_model_state()
    finally:
        model_module.reset_model_state()  # 다른 테스트가 진짜 번들을 다시 로드하게


def test_valid_fake_bundle_loads_and_predicts(tmp_path, monkeypatch):
    from app.core.config import settings as cfg

    # 이 테스트는 "오버라이드 부재 시 release.json 권장값 채택" 경로를 본다 —
    # settings 기본값이 라이브 임시 오버라이드(0.15)로 바뀌어도 의도를 유지한다
    monkeypatch.setattr(cfg, "reject_threshold", None)
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
    from app.core.config import settings as cfg

    # 오버라이드 부재 + release 권장값 부재 → 코드 폴백 채택 경로 (위 테스트와 동일 사유)
    monkeypatch.setattr(cfg, "reject_threshold", None)
    release = _valid_release()
    del release["serving"]["recommended_reject_threshold"]
    state = _load(tmp_path, monkeypatch, release)
    assert state.loaded
    assert state.reject_threshold == model_module.FALLBACK_REJECT_THRESHOLD


# ---------------------------------------------------------------- 로짓 편향 제거 (debias)
def _debias_formula(base: np.ndarray, bias: np.ndarray, alpha: float) -> np.ndarray:
    """live_eval 러너에서 검증된 수식 그대로 (수식 정본과의 대조 기대값) —
    log(clamp) − α·(bias − mean) → softmax 재정규화."""
    lp = np.log(np.maximum(base.astype(np.float64), 1e-12))
    lp = lp - alpha * (bias - bias.mean())
    e = np.exp(lp - lp.max())
    return e / e.sum()


def test_debias_fallback_when_file_missing(tmp_path, monkeypatch, caplog):
    """live_debias.npy 부재 → α=0 항등 폴백 + 경고 로그 1회 (로드는 성공 유지)."""
    with caplog.at_level("WARNING", logger="app.ml.model"):
        state = _load(tmp_path, monkeypatch, _valid_release())
    assert state.loaded
    assert state.debias_bias is None
    assert state.debias_alpha == 0.0
    warned = [r for r in caplog.records if model_module.DEBIAS_FILENAME in r.getMessage()]
    assert len(warned) == 1
    # 항등 확인: bias 없는 predict == 이후 alpha=0 으로 강제한 predict (완전 동일)
    x = np.zeros((16, FEAT_DIM), dtype=np.float32)
    probs = state.predict_probs(x)
    np.testing.assert_array_equal(probs, state.predict_probs(x))


def test_debias_applied_matches_runner_formula(tmp_path, monkeypatch):
    """bias 파일 존재 + α=1 → predict_probs == 러너 검증 수식. 클래스 0 과호출을
    본떠 만든 bias 가 스텁의 top-1(클래스 0)을 실제로 끌어내리는지도 본다."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "debias_alpha", 1.0)
    bias = np.zeros(300)
    bias[0] = 10.0  # 클래스 0 이 과호출된 아카이브를 흉내 낸 편향
    state = _load(tmp_path, monkeypatch, _valid_release(), debias=bias)
    assert state.loaded
    assert state.debias_bias is not None
    assert state.debias_alpha == 1.0

    x = np.zeros((16, FEAT_DIM), dtype=np.float32)
    debiased = state.predict_probs(x)
    state.debias_alpha = 0.0  # 같은 상태에서 편향 제거만 끈 기준 분포
    base = state.predict_probs(x)
    state.debias_alpha = 1.0

    np.testing.assert_allclose(debiased, _debias_formula(base, bias, 1.0), rtol=1e-6, atol=1e-9)
    assert int(np.argmax(base)) == 0  # 스텁 로짓의 top-1
    assert int(np.argmax(debiased)) != 0  # 편향 제거가 과호출 클래스를 끌어내린다
    np.testing.assert_allclose(debiased.sum(), 1.0, atol=1e-5)


def test_debias_alpha_zero_is_identity(tmp_path, monkeypatch):
    """settings.debias_alpha=0 이면 bias 파일이 있어도 완전 항등 (제거 끔)."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "debias_alpha", 0.0)
    rng = np.random.default_rng(7)
    state = _load(tmp_path, monkeypatch, _valid_release(), debias=rng.normal(size=300))
    assert state.loaded
    assert state.debias_alpha == 0.0
    x = np.zeros((16, FEAT_DIM), dtype=np.float32)
    probs = state.predict_probs(x)
    state.debias_bias = None  # bias 자체가 없는 경로와 완전 동일해야 한다
    np.testing.assert_array_equal(probs, state.predict_probs(x))


def test_debias_shape_mismatch_falls_back(tmp_path, monkeypatch, caplog):
    """(num_classes,) 아닌 bias 는 적용하지 않고 α=0 폴백 — 서빙은 죽이지 않는다."""
    with caplog.at_level("WARNING", logger="app.ml.model"):
        state = _load(tmp_path, monkeypatch, _valid_release(), debias=np.zeros(30))
    assert state.loaded
    assert state.debias_bias is None
    assert state.debias_alpha == 0.0
    assert any("형상 불일치" in r.getMessage() for r in caplog.records)
