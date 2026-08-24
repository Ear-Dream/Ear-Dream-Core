"""번들 로더(app/ml/model.py) 게이트 검증 — 가짜 번들로 거부 조건을 만든다.

실제 수십 MB TorchScript 대신 같은 시그니처의 소형 스크립트 모듈을 번들에 넣는다 —
게이트는 release.json 검증이 핵심이라 가중치 크기와 무관하다. 서빙 인터페이스가 둘이라
스텁도 둘이다 (모듈 docstring 「서빙 인터페이스 2종」):
  _StubSpoter  (features, padding_mask) -> (B, 300)
  _StubHybrid  (features, padding_mask, detected, view) -> 4-튜플, [0] 이 full_logits
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


class _StubHybrid(torch.nn.Module):
    """hybrid_v1 시그니처 스텁. full_logits 는 **detected 를 실제로 반영**한다 —
    로더가 마스크를 넘기지 않거나 엉뚱한 열을 넘기면 테스트가 잡아내야 하기 때문이다.
    클래스 0 = 오른손 검출 프레임 수, 클래스 1 = 왼손 검출 프레임 수를 로짓에 싣는다."""

    def forward(
        self,
        features: torch.Tensor,
        padding_mask: torch.Tensor,
        detected: torch.Tensor,
        view: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        batch = features.shape[0]
        valid = detected.float() * view.float()  # (B, T, 2) — 학습 모델과 같은 게이팅
        full = torch.zeros(batch, 300)
        full[:, 0] = valid[..., 0].sum(1)
        full[:, 1] = valid[..., 1].sum(1)
        return full, torch.zeros(batch, 106), torch.zeros(batch, 2), torch.zeros(batch, 128)


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


def _hybrid_release(**overrides) -> dict:
    release = _valid_release(model_name="hybrid_208_h1b")
    release["serving"] = {**release["serving"], "interface": "hybrid_v1", "view": "full"}
    release.update(overrides)
    return release


def _write_bundle(tmp_path: Path, release: dict, debias: np.ndarray | None = None) -> Path:
    bundle = tmp_path / "fake-bundle"
    bundle.mkdir(parents=True, exist_ok=True)
    interface = (release.get("serving") or {}).get("interface", model_module.DEFAULT_INTERFACE)
    stub = {
        model_module.INTERFACE_HYBRID: _StubHybrid,
        model_module.INTERFACE_SINGLE_OBSERVED: _StubSingleObserved,
    }.get(interface, _StubSpoter)()
    torch.jit.save(torch.jit.script(stub), str(bundle / "model_torchscript.pt"))
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
    """live_debias.npy 부재 → α=0 항등 폴백 + 로그 1회 (로드는 성공 유지).

    ⚠️ 이 로그는 WARNING 이 아니라 INFO 다 — 편향 벡터는 모델별이라 추정하지 않은
    번들이 싣지 않는 것 자체는 정상 상태다 (app/ml/model._load_debias 주석)."""
    with caplog.at_level("INFO", logger="app.ml.model"):
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


# ------------------------------------------------------- 서빙 인터페이스 (spoter/hybrid)
def test_interface_defaults_to_spoter_when_absent(tmp_path, monkeypatch):
    """serving.interface 가 없는 번들 = 스위치 도입 이전의 SPOTER 번들 — 롤백 호환."""
    release = _valid_release()
    release["serving"].pop("interface", None)
    state = _load(tmp_path, monkeypatch, release)
    assert state.loaded, f"load failed: {state.error}"
    assert state.interface == model_module.INTERFACE_SPOTER
    # 구 인터페이스는 손 마스크를 받지 않는다 — 인자 없이 호출돼야 한다
    probs = state.predict_probs(np.zeros((16, FEAT_DIM), dtype=np.float32))
    assert int(np.argmax(probs)) == 0


def test_load_refused_on_unknown_interface(tmp_path, monkeypatch):
    """모르는 호출 규약으로 forward 하지 않는다 — 잘못된 인자 수는 런타임 폭발이다."""
    state = _load(tmp_path, monkeypatch, _hybrid_release(serving={"interface": "hybrid_v9"}))
    assert not state.loaded
    assert "interface" in (state.error or "")


def test_hybrid_uses_full_logits_and_forwards_detected(tmp_path, monkeypatch):
    """hybrid_v1: 4출력 중 full_logits 만 쓰고, 손 검출 마스크가 그대로 전달돼야 한다.

    스텁이 클래스 0/1 로짓에 오른손/왼손 검출 프레임 수를 싣는다 — 열 순서가 뒤집히면
    argmax 가 반대로 나온다 (조용한 좌우 뒤바뀜 방지)."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "reject_threshold", None)
    state = _load(tmp_path, monkeypatch, _hybrid_release())
    assert state.loaded, f"load failed: {state.error}"
    assert state.interface == model_module.INTERFACE_HYBRID

    x = np.zeros((16, FEAT_DIM), dtype=np.float32)
    # 오른손 12 프레임 / 왼손 3 프레임 검출 → 클래스 0 이 최고여야 한다
    detected = np.zeros((16, 2), dtype=np.uint8)
    detected[:12, 0] = 1
    detected[:3, 1] = 1
    probs = state.predict_probs(x, detected)
    assert probs.shape == (300,)
    np.testing.assert_allclose(probs.sum(), 1.0, atol=1e-5)
    assert int(np.argmax(probs)) == 0

    # 좌우를 뒤집으면 결과도 뒤집혀야 한다 (마스크가 실제로 쓰인다는 확인)
    assert int(np.argmax(state.predict_probs(x, detected[:, ::-1].copy()))) == 1


def test_hybrid_requires_hand_detected(tmp_path, monkeypatch):
    """마스크 없이 호출하면 조용히 전 프레임 검출로 가정하지 않고 즉시 실패한다 —
    학습과 다른 게이팅으로 도는 것보다 터지는 편이 낫다."""
    import pytest

    state = _load(tmp_path, monkeypatch, _hybrid_release())
    x = np.zeros((16, FEAT_DIM), dtype=np.float32)
    with pytest.raises(ValueError, match="hand_detected"):
        state.predict_probs(x)
    with pytest.raises(ValueError, match="hand_detected"):
        state.predict_probs(x, np.ones((8, 2), dtype=np.uint8))  # 프레임 수 불일치


# --------------------------------------------- single_observed_v1 (대표 손 하나만 보는 세대)
class _StubSingleObserved(torch.nn.Module):
    """single_observed_v1 시그니처 스텁 (3출력). logits 에 **입력 검증 결과**를 싣는다 —
    클래스 0 = 오른손 구간 절댓값 합, 클래스 1 = 왼손 구간 절댓값 합, 클래스 2 = view 의
    오른손 성분 합. 서빙이 반대 손을 안 지우거나 view 를 잘못 주면 argmax 가 달라진다."""

    def forward(
        self,
        features: torch.Tensor,
        padding_mask: torch.Tensor,
        detected: torch.Tensor,
        view: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        batch = features.shape[0]
        logits = torch.zeros(batch, 300)
        logits[:, 0] = features[..., 50:92].abs().sum((1, 2))
        logits[:, 1] = features[..., 92:134].abs().sum((1, 2))
        logits[:, 2] = view[..., 0].sum(1)
        return logits, torch.zeros(batch, 2), torch.zeros(batch, 128)


def _single_observed_release(**overrides) -> dict:
    release = _valid_release(model_name="single_observed_hand_208")
    release["serving"] = {
        **release["serving"],
        "interface": "single_observed_v1",
        "view": "single_observed",
        "temperature": 1.0,
    }
    release.update(overrides)
    return release


def _reference_robust_motion_side(features, detected, coverage_margin=0.15):
    """학습 레포 single_observed_hand_300/dataset.robust_motion_side 의 **인라인 복사본**.

    test_preprocess_spoter 가 레퍼런스 전처리와 대조하는 것과 같은 취지다 — 대표 손
    선택이 학습과 갈리면 모델이 보는 손 자체가 달라진다 (train/serve skew)."""
    right, left = slice(50, 92), slice(92, 134)
    coverage = (
        detected.astype(np.float32).mean(axis=0) if len(detected) else np.zeros(2, np.float32)
    )
    if coverage[0] > coverage[1] + coverage_margin:
        return 0
    if coverage[1] > coverage[0] + coverage_margin:
        return 1
    energies = []
    for part, mask in ((features[:, right], detected[:, 0]), (features[:, left], detected[:, 1])):
        if len(part) < 2:
            energies.append(0.0)
            continue
        velocity = np.abs(np.diff(part, axis=0)).mean(axis=1)
        valid = (mask[:-1] > 0) & (mask[1:] > 0)
        values = velocity[valid]
        if len(values) >= 5:
            low, high = np.quantile(values, (0.1, 0.9))
            values = values[(values >= low) & (values <= high)]
        energies.append(float(np.median(values)) if len(values) else 0.0)
    return int(energies[1] > energies[0])


def test_robust_motion_side_matches_training_reference():
    """대표 손 선택이 학습 레퍼런스와 **모든 난수 케이스에서** 일치해야 한다."""
    rng = np.random.default_rng(20260824)
    for _ in range(200):
        t = int(rng.integers(1, 40))
        x = rng.normal(size=(t, FEAT_DIM)).astype(np.float32)
        # 검출 패턴을 다양하게 — 한쪽만/양쪽/희박
        detected = (rng.random((t, 2)) < rng.choice([0.05, 0.5, 0.95])).astype(np.uint8)
        assert model_module.robust_motion_side(x, detected) == _reference_robust_motion_side(
            x, detected
        )


def test_single_observed_masks_other_hand_and_sets_view(tmp_path, monkeypatch):
    """반대 손 42차원이 0 으로 지워지고 view 가 선택 손 one-hot 이어야 한다."""
    from app.core.config import settings as cfg

    monkeypatch.setattr(cfg, "reject_threshold", None)
    state = _load(tmp_path, monkeypatch, _single_observed_release())
    assert state.loaded, f"load failed: {state.error}"
    assert state.interface == model_module.INTERFACE_SINGLE_OBSERVED

    t = 20
    x = np.ones((t, FEAT_DIM), dtype=np.float32)
    # 오른손만 검출 → 검출률 차이 1.0 > 0.15 이므로 오른손이 선택된다
    detected = np.zeros((t, 2), dtype=np.uint8)
    detected[:, 0] = 1
    probs = state.predict_probs(x, detected)
    # 스텁 로짓: 클래스 0=오른손 합(42*20=840), 1=왼손 합(지워져 0), 2=view 오른손 합(20)
    assert int(np.argmax(probs)) == 0

    # 왼손만 검출 → 왼손 선택 → 오른손이 0 이 되어 클래스 1 이 최고여야 한다
    flipped = detected[:, ::-1].copy()
    assert int(np.argmax(state.predict_probs(x, flipped))) == 1


def test_single_observed_requires_hand_detected(tmp_path, monkeypatch):
    import pytest

    state = _load(tmp_path, monkeypatch, _single_observed_release())
    with pytest.raises(ValueError, match="hand_detected"):
        state.predict_probs(np.zeros((16, FEAT_DIM), dtype=np.float32))
