"""SPOTER-208 (300단어) TorchScript 추론 모듈 — 로컬 번들 로딩.

로딩 단위는 **번들 디렉토리** (settings.model_bundle_dir, 기본 var/models/spoter300-pilot):

    release.json          -> 기계 판독 핸드오프 (정본): feature_version, model_name,
                             num_classes, class_labels(한국어, 인덱스 순),
                             serving{artifact, temperature, recommended_reject_threshold},
                             source(학습 run 경로·지표)
    model_torchscript.pt  -> torch.jit.trace 산출물. forward(features[B,T,208],
                             padding_mask[B,T] bool) -> logits[B,300]
                             (export_parity.json 에서 native와 로짓 오차 0 확인됨)

번들 생성: scripts/build_spoter300_bundle.py (벤치마크 레포 산출물 → var/models/).
var/ 는 .gitignore — 모델 파일은 레포에 커밋하지 않는다. GitHub 릴리스 전환은 검증 후
별도 결정 (지금은 로컬 번들로 실험).

로드 게이트 — 어긋난 조합 사고 방지 (v2 로더의 원칙 유지):
  - release.json feature_version != 서버 PREPROCESS_VERSION → 거부 (train/serve skew)
  - num_classes != 300(VOCAB_SIZE) 또는 class_labels 길이 불일치 → 거부
  - class_labels 가 vocab300.json(CLASS_INDEX_TO_ENTRY) 순서와 불일치 → 거부
    (여기가 틀리면 조용히 전부 오답 — 어휘 데이터와 번들은 같은 classes.json 에서
    생성되므로 정상 경로에서는 항상 일치한다)
로딩 실패 시 예외를 삼키고 loaded=False — 서버는 뜨되 /recognize 가 503 을 반환하고
/health 의 model_loaded 가 false 다 (기존 시맨틱 유지).

추론: [T,208] → forward → logits ÷ temperature(release.json, 현재 1.8489) → softmax
→ top-k. 최고 confidence < reject_threshold 면 rejected. reject 임계는 release.json
recommended_reject_threshold(0.5)가 기본이고 settings.reject_threshold 로 오버라이드한다.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from app.core.config import settings
from app.ml.preprocess_spoter import FEAT_DIM, PREPROCESS_VERSION
from app.ml.vocab import CLASS_INDEX_TO_ENTRY, VOCAB_SIZE, VocabEntry

logger = logging.getLogger(__name__)

# reject 임계 최후 fallback — release.json 권장값 부재 + 설정 오버라이드 부재일 때만.
# ⚠️ 임시값 (calibration.json threshold_sweep 0.5 지점 — val coverage 94.8% /
# kept acc 95.3%. 라이브 분포 미검증 — config.py 주석 참조)
FALLBACK_REJECT_THRESHOLD = 0.5


@dataclass
class ModelState:
    loaded: bool = False
    model: torch.jit.ScriptModule | None = None
    model_name: str = "spoter_208"
    model_version: str = "unloaded"  # 번들 이름 (release.json bundle, 예: spoter300-pilot)
    num_classes: int = VOCAB_SIZE
    # 클래스 인덱스 → 어휘 항목. release.json class_labels 와 로드 시 교차 검증된다.
    class_entries: list[VocabEntry] = field(default_factory=lambda: CLASS_INDEX_TO_ENTRY)
    # temperature scaling (release.json serving.temperature) — softmax 전에 나눈다
    temperature: float = 1.0
    # rejected 판정 임계 (release.json 권장값 또는 설정 오버라이드 — 로드 시 확정)
    reject_threshold: float = FALLBACK_REJECT_THRESHOLD
    error: str | None = None

    def predict_probs(self, x: np.ndarray) -> np.ndarray:
        """(T, 208) float32 → 캘리브레이션된 softmax 확률 (num_classes,).

        padding_mask 는 전 프레임 유효(False) — 서빙은 배치 1, 패딩 없음.
        """
        assert self.model is not None
        assert x.ndim == 2 and x.shape[1] == FEAT_DIM, f"expected (T,{FEAT_DIM}), got {x.shape}"
        features = torch.from_numpy(x).unsqueeze(0)  # (1, T, 208)
        padding_mask = torch.zeros(1, x.shape[0], dtype=torch.bool)
        with torch.no_grad():
            logits = self.model(features, padding_mask)  # (1, C)
            return torch.softmax(logits / self.temperature, dim=-1).squeeze(0).numpy()


def resolve_bundle_dir() -> Path:
    """설정의 번들 디렉토리를 api 패키지 루트 기준 절대경로로 해석한다."""
    raw = Path(settings.model_bundle_dir)
    if raw.is_absolute():
        return raw
    return (settings.package_root / raw).resolve()


def _validate_release(release: dict) -> None:
    """release.json 로드 게이트 (모듈 docstring 참조). 실패 시 ValueError."""
    feature_version = str(release.get("feature_version", ""))
    if feature_version != PREPROCESS_VERSION:
        raise ValueError(
            f"release feature_version={feature_version!r} != 서버 "
            f"PREPROCESS_VERSION={PREPROCESS_VERSION!r} — 전처리와 가중치가 어긋난 "
            "조합은 서빙하지 않는다 (train/serve skew)"
        )
    num_classes = int(release.get("num_classes", -1))
    if num_classes != VOCAB_SIZE:
        raise ValueError(
            f"release num_classes={num_classes} != vocab size {VOCAB_SIZE} — "
            "어휘 데이터(vocab300.json)와 번들이 어긋났다"
        )
    class_labels = release.get("class_labels")
    if not isinstance(class_labels, list):
        raise TypeError("release.json 에 class_labels 배열이 없다")
    if len(class_labels) != num_classes:
        raise ValueError(
            f"release class_labels 길이 {len(class_labels)} != num_classes {num_classes}"
        )
    vocab_labels = [e.label for e in CLASS_INDEX_TO_ENTRY]
    if [str(x) for x in class_labels] != vocab_labels:
        mism = next(i for i, (a, b) in enumerate(zip(class_labels, vocab_labels)) if str(a) != b)
        raise ValueError(
            "release class_labels 가 vocab300.json 인덱스 순서와 불일치 — 로드 거부 "
            f"(첫 불일치 index={mism}: release={class_labels[mism]!r} vs "
            f"vocab={vocab_labels[mism]!r}). 조용한 전량 오답 방지"
        )


def _load_state() -> ModelState:
    bundle = resolve_bundle_dir()
    release_path = bundle / "release.json"
    try:
        release = json.loads(release_path.read_text(encoding="utf-8"))
        _validate_release(release)

        serving = release.get("serving") or {}
        artifact = str(serving.get("artifact", "model_torchscript.pt"))
        model = torch.jit.load(str(bundle / artifact), map_location="cpu")
        model.eval()

        temperature = float(serving.get("temperature", 1.0))
        if not (0.0 < temperature < 100.0):
            raise ValueError(f"temperature out of range: {temperature}")

        # reject 임계: 설정 오버라이드 > release.json 권장값 > fallback
        if settings.reject_threshold is not None:
            reject_threshold = float(settings.reject_threshold)
        elif serving.get("recommended_reject_threshold") is not None:
            reject_threshold = float(serving["recommended_reject_threshold"])
        else:
            logger.warning(
                "release.json 에 recommended_reject_threshold 가 없다 — fallback %.2f 사용",
                FALLBACK_REJECT_THRESHOLD,
            )
            reject_threshold = FALLBACK_REJECT_THRESHOLD

        state = ModelState(
            loaded=True,
            model=model,
            model_name=str(release.get("model_name", "spoter_208")),
            model_version=str(release.get("bundle", bundle.name)),
            num_classes=int(release["num_classes"]),
            class_entries=CLASS_INDEX_TO_ENTRY,
            temperature=temperature,
            reject_threshold=reject_threshold,
        )
        logger.info(
            "model loaded: %s (%s, feature_version=%s, temperature=%.4f, "
            "reject_threshold=%.2f) from %s",
            state.model_name,
            state.model_version,
            release["feature_version"],
            state.temperature,
            state.reject_threshold,
            bundle,
        )
        return state
    except Exception as exc:  # noqa: BLE001 — 서버는 뜨되 /recognize 만 503
        logger.warning("model load failed (%s): %s", bundle, exc)
        return ModelState(loaded=False, error=str(exc))


_state: ModelState | None = None


def get_model_state() -> ModelState:
    """지연 로딩 싱글턴. 첫 호출 시 번들을 읽는다."""
    global _state
    if _state is None:
        _state = _load_state()
    return _state


def reset_model_state() -> None:
    """테스트 전용: 다음 get_model_state() 가 다시 로드하게 한다."""
    global _state
    _state = None
