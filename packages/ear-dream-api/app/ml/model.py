"""208D 300단어 TorchScript 추론 모듈 — 로컬 번들 로딩.

로딩 단위는 **번들 디렉토리** (settings.model_bundle_dir, 기본 var/models/hybrid300-h1b):

    release.json          -> 기계 판독 핸드오프 (정본): feature_version, model_name,
                             num_classes, class_labels(한국어, 인덱스 순),
                             serving{artifact, interface, temperature,
                             recommended_reject_threshold}, source(학습 run 경로·지표)
    model_torchscript.pt  -> torch.jit.trace 산출물. 호출 규약은 두 가지고
                             release.json serving.interface 가 고른다 (아래).

**서빙 인터페이스 2종** — 모델 세대가 갈려서 forward 시그니처가 다르다. 번들이
스스로 어느 쪽인지 밝히므로 구 번들로 롤백해도 코드 변경이 필요 없다
(serving.interface 가 없는 번들 = 구 SPOTER 번들로 취급):

  "spoter_v1" (var/models/spoter300-pilot — SPOTER-208 베이스라인)
      forward(features[B,T,208], padding_mask[B,T] bool) -> logits[B,300]

  "hybrid_v1" (var/models/hybrid300-h1b — one_hand_hybrid H1b, 현재 기본)
      forward(features[B,T,208], padding_mask[B,T] bool,
              detected[B,T,2], view[B,T,2])
          -> (full_logits[B,300], onehand_logits[B,106],
              hand_type_logits[B,2], embedding[B,128])
      서빙은 **full_logits 만** 쓴다. 나머지 3 출력의 위치:
        - onehand_logits(106): 학습 레포 실측상 selected-hand top-1 90.75% 로 300 head
          보다 낮아 확정 분류에 쓰지 않기로 한 head 다 (보조·ablation 용도로만 존재)
        - hand_type_logits: 한손/양손 이진 분류. hard routing 에 쓰지 않는다 —
          학습 레포가 라우팅을 쓰지 않기로 결론냈다
        - embedding(128): prototype retrieval 용. 서빙 top-k 는 300 head 로짓에서
          나오므로 prototype bank(h2_prototypes.npz)를 번들에 넣지 않았다

  detected/view 의 의미 (hybrid_v1):
      detected[..., 0/1] = 그 프레임에서 오른손/왼손이 **검출됐는지** — 전처리
          part_mask 의 right_hand/left_hand 열을 그대로 넘긴다 (PARTS 순서:
          pose, right_hand, left_hand, face → 열 1,2).
      view[..., 0/1] = 그 손을 모델에 **보여줄지**. 서빙은 항상 FULL(1,1) 이다.
          ⚠️ right_only/left_only view 는 "검출된 손을 일부러 가리는" 학습·평가측
          ablation 이다. 라이브에서 한손 단어를 하면 반대손은 애초에 검출되지 않아
          detected=0 + 해당 폭 0-채움으로 들어오므로, FULL view + 실제 detected 가
          학습의 x_full 경로와 정확히 같은 입력이다. 여기서 view 를 손 검출률로
          분기시키면 학습에 없는 입력 조합과 새 임계 상수가 동시에 생긴다.

번들 생성: scripts/build_hybrid300_bundle.py (베이스라인은 build_spoter300_bundle.py).
var/ 는 .gitignore — 모델 파일은 레포에 커밋하지 않는다.

로드 게이트 — 어긋난 조합 사고 방지 (v2 로더의 원칙 유지):
  - release.json feature_version != 서버 PREPROCESS_VERSION → 거부 (train/serve skew)
  - num_classes != 300(VOCAB_SIZE) 또는 class_labels 길이 불일치 → 거부
  - class_labels 가 vocab300.json(CLASS_INDEX_TO_ENTRY) 순서와 불일치 → 거부
    (여기가 틀리면 조용히 전부 오답 — 두 모델 세대가 같은 인덱스 체계를 쓰는지
    빌드 스크립트가 한 번, 로더가 한 번 확인한다)
  - serving.interface 가 아는 값이 아니면 → 거부 (모르는 규약으로 호출하지 않는다)
로딩 실패 시 예외를 삼키고 loaded=False — 서버는 뜨되 /recognize 가 503 을 반환하고
/health 의 model_loaded 가 false 다 (기존 시맨틱 유지).

추론: [T,208] → forward → logits ÷ temperature(release.json) → softmax
→ **로짓 편향 제거**(아래) → top-k. 최고 confidence < reject_threshold 면 rejected.
reject 임계는 release.json recommended_reject_threshold 가 기본이고
settings.reject_threshold 로 오버라이드한다.
⚠️ hybrid300-h1b 는 temperature 가 **미캘리브레이션(1.0 항등)** 이고 편향 제거도
꺼져 있다 — 학습 레포에 분류 head 용 온도 산출물이 없기 때문이다(그쪽
hybrid_calibration.json 은 retrieval 코사인 임계다). 따라서 이 번들의 confidence 는
베이스라인 수치와 직접 비교할 수 없고, 권장 reject 임계도 0.0(거부 없음)이다.

로짓 편향 제거 — 라이브 도메인 갭 개입 (2026-08-11 실측, config.debias_alpha 주석 참조):
  번들의 live_debias.npy (num_classes,) — 라벨 없는 실사용 아카이브의 평균
  log-softmax — 를 캘리브레이션과 같은 패턴으로 로드해, softmax 후
  log(p) − α·(bias − bias.mean()) 을 다시 softmax 한다 (평균 센터링으로 스케일 보존.
  수식은 live_eval 러너 검증 구현의 포팅 — 동일 연산 유지). 파일이 없으면 α=0 항등 +
  경고 로그 1회.
  ⚠️ **편향 벡터는 모델별이다.** 추정에 쓴 모델의 출력 분포에 묶인 값이라 다른
  가중치에 그대로 쓰면 보정이 아니라 새 편향 주입이 된다 — 그래서 hybrid300-h1b
  번들에는 이 파일을 넣지 않았고(빌드 스크립트가 복사하지 않는다) α=0 으로 돈다.
  ⚠️ confidence 정의: 편향 제거가 켜진 번들에서는 reject 임계 비교와 응답
  confidence 가 **편향 제거 후 분포의 softmax** 다 (진단 레코드 response.debias_*
  에 적용 여부가 남는다).
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

# 서빙 인터페이스 (release.json serving.interface — 모듈 docstring 「서빙 인터페이스 2종」).
# 필드가 없는 번들은 이 스위치 도입 이전에 만들어진 SPOTER 번들이다.
INTERFACE_SPOTER = "spoter_v1"
INTERFACE_HYBRID = "hybrid_v1"
KNOWN_INTERFACES = (INTERFACE_SPOTER, INTERFACE_HYBRID)
DEFAULT_INTERFACE = INTERFACE_SPOTER


@dataclass
class ModelState:
    loaded: bool = False
    model: torch.jit.ScriptModule | None = None
    model_name: str = "spoter_208"
    model_version: str = "unloaded"  # 번들 이름 (release.json bundle, 예: hybrid300-h1b)
    # forward 호출 규약 (모듈 docstring). 번들이 스스로 밝히므로 롤백에 코드 변경이 없다.
    interface: str = DEFAULT_INTERFACE
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

    def predict_probs(self, x: np.ndarray, hand_detected: np.ndarray | None = None) -> np.ndarray:
        """(T, 208) float32 → 캘리브레이션 + 편향 제거된 softmax 확률 (num_classes,).

        hand_detected: (T, 2) — 프레임별 [오른손, 왼손] 검출 여부. 전처리 결과의
            part_mask[:, 1:3] 을 그대로 넘긴다 (PreprocessOutput.part_mask 열 순서는
            PARTS = pose, right_hand, left_hand, face). "hybrid_v1" 인터페이스에서만
            쓰이고 **필수**다 — 없으면 손 결측 게이팅이 학습과 달라진다.
            "spoter_v1" 번들은 이 인자를 받지 않으므로 무시한다.

        padding_mask 는 전 프레임 유효(False) — 서빙은 배치 1, 패딩 없음.
        view 는 항상 FULL(1,1) 이다 (모듈 docstring 「detected/view 의 의미」).
        ⚠️ 반환 확률이 confidence 의 정의다 — 편향 제거가 켜져 있으면(모듈 docstring)
        reject 임계 비교·응답 confidence 모두 **제거 후 분포** 기준이다.
        """
        assert self.model is not None
        assert x.ndim == 2 and x.shape[1] == FEAT_DIM, f"expected (T,{FEAT_DIM}), got {x.shape}"
        features = torch.from_numpy(x).unsqueeze(0)  # (1, T, 208)
        padding_mask = torch.zeros(1, x.shape[0], dtype=torch.bool)
        with torch.no_grad():
            if self.interface == INTERFACE_HYBRID:
                if hand_detected is None:
                    raise ValueError(
                        f"interface={self.interface} 는 hand_detected (T,2) 가 필수다 — "
                        "전처리 part_mask[:, 1:3] 을 넘길 것"
                    )
                if hand_detected.shape != (x.shape[0], 2):
                    raise ValueError(
                        f"hand_detected 형상 {hand_detected.shape} != {(x.shape[0], 2)}"
                    )
                detected = torch.from_numpy(
                    np.ascontiguousarray(hand_detected, dtype=np.float32)
                ).unsqueeze(0)  # (1, T, 2)
                view = torch.ones_like(detected)  # FULL — 서빙은 손을 가리지 않는다
                logits = self.model(features, padding_mask, detected, view)[0]  # full_logits
            else:
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
    interface = str((release.get("serving") or {}).get("interface", DEFAULT_INTERFACE))
    if interface not in KNOWN_INTERFACES:
        raise ValueError(
            f"release serving.interface={interface!r} 를 모른다 (아는 값: "
            f"{', '.join(KNOWN_INTERFACES)}) — 모르는 호출 규약으로 forward 하지 않는다"
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
        # 번들이 편향 벡터를 싣지 않는 것 자체는 정상 상태다 (편향은 모델별이라
        # 추정하지 않은 번들에는 넣지 않는다 — hybrid300-h1b 가 그렇다). 다만
        # spoter300-pilot 처럼 있어야 할 번들에서 빠지면 정확도 개입이 조용히 사라지므로
        # 어느 쪽이든 로그로는 남긴다 (config.debias_alpha 주석 참조).
        logger.info(
            "%s 가 없다 — 로짓 편향 제거를 α=0(항등)으로 서빙한다: %s",
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
        interface = str(serving.get("interface", DEFAULT_INTERFACE))
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
            interface=interface,
            num_classes=int(release["num_classes"]),
            class_entries=CLASS_INDEX_TO_ENTRY,
            temperature=temperature,
            reject_threshold=reject_threshold,
            debias_bias=debias_bias,
            debias_alpha=debias_alpha,
        )
        logger.info(
            "model loaded: %s (%s, interface=%s, feature_version=%s, temperature=%.4f, "
            "reject_threshold=%.2f, debias_alpha=%.2f%s) from %s",
            state.model_name,
            state.model_version,
            state.interface,
            release["feature_version"],
            state.temperature,
            state.reject_threshold,
            state.debias_alpha,
            "" if state.debias_bias is not None else " (bias 파일 없음)",
            bundle,
        )
        return state
    except Exception as exc:  # noqa: BLE001 — 서버는 뜨되 /recognize 만 503
        # 번들 미설치가 가장 흔한 원인이라 받는 방법을 함께 찍는다 — 서버는 뜨고
        # /recognize 만 503 이라 로그를 안 보면 "왜 인식이 안 되지" 로만 보인다.
        logger.warning(
            "model load failed (%s): %s — 번들이 없으면 `pnpm setup:model-bundle` "
            "(README 「모델 번들」)",
            bundle,
            exc,
        )
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
