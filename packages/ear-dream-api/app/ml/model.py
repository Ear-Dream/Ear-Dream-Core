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
→ **로짓 편향 제거**(아래) → top-k. 최고 confidence < reject_threshold 면 rejected.
reject 임계는 release.json recommended_reject_threshold(0.5)가 기본이고
settings.reject_threshold 로 오버라이드한다.

로짓 편향 제거 — 라이브 도메인 갭 개입 (2026-08-11 실측, config.debias_alpha 주석 참조):
  번들의 live_debias.npy (num_classes,) — 라벨 없는 실사용 아카이브 405건의 평균
  log-softmax — 를 캘리브레이션과 같은 패턴으로 로드해, softmax 후
  log(p) − α·(bias − bias.mean()) 을 다시 softmax 한다 (평균 센터링으로 스케일 보존.
  수식은 live_eval 러너 검증 구현의 포팅 — 동일 연산 유지). 파일이 없으면 α=0 항등 +
  경고 로그 1회.
  ⚠️ confidence 정의 변경: reject 임계 비교와 응답 confidence 는 이제 **편향 제거 후
  분포의 softmax** 다 — 편향 제거 이전 값이 아니다. 임계(0.15)·conf 분포를 과거
  기록과 비교할 때 이 정의 차이를 감안할 것 (진단 레코드 response.debias_* 에 적용
  여부가 남는다).
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

# 로짓 편향 벡터 파일명 (번들 디렉토리 내 — 모듈 docstring 편향 제거 절)
DEBIAS_FILENAME = "live_debias.npy"


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
    # 로짓 편향 제거 (모듈 docstring) — 번들 live_debias.npy 부재 시 bias=None, α=0 항등.
    # live_eval 러너는 이 두 필드를 직접 바꿔 실험 조건을 오버라이드한다.
    debias_bias: np.ndarray | None = None  # (num_classes,) float64 — 평균 log-softmax
    debias_alpha: float = 0.0  # 실제 적용되는 강도 (settings.debias_alpha, 부재 폴백 0)
    error: str | None = None

    def predict_probs(self, x: np.ndarray) -> np.ndarray:
        """(T, 208) float32 → 캘리브레이션 + 편향 제거된 softmax 확률 (num_classes,).

        padding_mask 는 전 프레임 유효(False) — 서빙은 배치 1, 패딩 없음.
        ⚠️ 반환 확률이 confidence 의 정의다 — 편향 제거가 켜져 있으면(모듈 docstring)
        reject 임계 비교·응답 confidence 모두 **제거 후 분포** 기준이다.
        """
        assert self.model is not None
        assert x.ndim == 2 and x.shape[1] == FEAT_DIM, f"expected (T,{FEAT_DIM}), got {x.shape}"
        features = torch.from_numpy(x).unsqueeze(0)  # (1, T, 208)
        padding_mask = torch.zeros(1, x.shape[0], dtype=torch.bool)
        with torch.no_grad():
            logits = self.model(features, padding_mask)  # (1, C)
            probs = torch.softmax(logits / self.temperature, dim=-1).squeeze(0).numpy()
        if self.debias_bias is None or self.debias_alpha == 0.0:
            return probs  # α=0 항등 — 편향 제거 이전과 완전 동일
        # 편향 제거 — live_eval 러너 검증 구현과 동일 연산 (평균 센터링으로 스케일 보존,
        # log 클램프 1e-12 포함). 수정 시 대조 테스트(test_model_bundle)와 동시 변경.
        lp = np.log(np.maximum(probs.astype(np.float64), 1e-12))
        lp -= self.debias_alpha * (self.debias_bias - self.debias_bias.mean())
        e = np.exp(lp - lp.max())
        return (e / e.sum()).astype(np.float32)


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


def _load_debias(bundle: Path, num_classes: int) -> tuple[np.ndarray | None, float]:
    """번들의 live_debias.npy → (bias, 적용 α). 부재·형상 불일치면 (None, 0.0) 항등.

    캘리브레이션 로드와 같은 패턴 — 보조 파일 문제로 서빙 전체를 죽이지 않는다
    (503 대신 개입만 끄고 **경고 로그**로 크게 남긴다. 항등 폴백은 안전하다 —
    개선 폭만 잃고 잘못된 보정이 적용될 일은 없다)."""
    path = bundle / DEBIAS_FILENAME
    if not path.is_file():
        logger.warning(
            "%s 가 없다 — 로짓 편향 제거를 α=0(항등)으로 서빙한다. "
            "라이브 정확도 개입이 빠진 상태다 (config.debias_alpha 주석 참조): %s",
            DEBIAS_FILENAME,
            path,
        )
        return None, 0.0
    bias = np.load(path)
    if bias.shape != (num_classes,):
        logger.warning(
            "%s 형상 불일치 (%s != (%d,)) — 편향 제거를 α=0(항등)으로 폴백한다: %s",
            DEBIAS_FILENAME,
            bias.shape,
            num_classes,
            path,
        )
        return None, 0.0
    return bias.astype(np.float64), float(settings.debias_alpha)


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

        debias_bias, debias_alpha = _load_debias(bundle, int(release["num_classes"]))

        state = ModelState(
            loaded=True,
            model=model,
            model_name=str(release.get("model_name", "spoter_208")),
            model_version=str(release.get("bundle", bundle.name)),
            num_classes=int(release["num_classes"]),
            class_entries=CLASS_INDEX_TO_ENTRY,
            temperature=temperature,
            reject_threshold=reject_threshold,
            debias_bias=debias_bias,
            debias_alpha=debias_alpha,
        )
        logger.info(
            "model loaded: %s (%s, feature_version=%s, temperature=%.4f, "
            "reject_threshold=%.2f, debias_alpha=%.2f%s) from %s",
            state.model_name,
            state.model_version,
            release["feature_version"],
            state.temperature,
            state.reject_threshold,
            state.debias_alpha,
            "" if state.debias_bias is not None else " (bias 파일 없음)",
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
