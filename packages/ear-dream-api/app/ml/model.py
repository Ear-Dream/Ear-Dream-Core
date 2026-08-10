"""SqueezeformerLite 추론 모듈 — 모델 레포 `src/models.py` 포팅 + 체크포인트 로딩.

포팅 범위: 서빙에 필요한 것만 (AttentionPooling, ConvModule, FeedForward, MHSAModule,
SqueezeformerLiteBlock, SqueezeformerLite, build_model). 학습용 loss/baseline 은 제외.

체크포인트 구조 (exp15_small_v2_z-off_f4/best.pt 를 map_location="cpu" 로 실측, 2026-08-10):
    dict wrapper:
      state_dict         -> 모델 state_dict (113 keys, 예: "pos_emb", "proj.0.weight", ...)
      source             -> "ema"
      epoch              -> 47
      val_top1           -> 1.0
      model              -> "small"          (d=128 / 4층 — small_cpu 아님)
      num_classes        -> 30
      T                  -> 32
      seed               -> 42
      class_labels       -> 한국어 라벨 30개 (클래스 인덱스 순) — 어휘 매핑의 정본
      preprocess_version -> "2"              (서버 PREPROCESS_VERSION 과 일치해야 로드)
      use_z              -> False            (전처리 z 분기 입력 — 아래 참조)

로드 거부 조건 (핸드오프 07_serving_handoff.md §3 · 09_z_gap_response.md §3):
  - preprocess_version 불일치 — 구모델+신전처리(또는 그 반대) 조합 사고 방지
  - class_labels 가 vocab.py 의 sorted 규약과 불일치 — 조용한 전량 오답 방지
  - use_z 필드 부재 — z 계약을 모르는 구형 체크포인트는 서빙 대상이 아니다.
    필드가 **있으면** 값(True/False)에 따라 전처리 z 처리를 분기한다
    (preprocess_eval 의 use_z 인자로 배선 — 09 §3-1에서 거부→분기로 게이트 완화).
로딩 실패 시 예외를 삼키고 loaded=False 로 둔다 — 서버는 뜨되 /recognize 가 503 을 반환한다.

캘리브레이션: temperature scaling (모델 레포 experiments/calibration.json 에서 로드).
softmax 전에 logits 를 temperature 로 나눈다 — 파일이 없으면 1.0 + 경고 로그.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

from app.core.config import settings
from app.ml.preprocess import PREPROCESS_VERSION, TARGET_T
from app.ml.vocab import CLASS_INDEX_TO_ENTRY, LABEL_TO_ENTRY, VOCAB_SIZE, VocabEntry

logger = logging.getLogger(__name__)

MAX_LEN = 64  # supports T=32 and T=48 with headroom (models.py 와 동일)


# ---------------------------------------------------------------------------
# 모델 정의 (models.py 포팅 — 구조를 바꾸면 state_dict 가 안 맞는다)
# ---------------------------------------------------------------------------


class AttentionPooling(nn.Module):
    """Additive attention pooling over time. (B, T, D) -> (B, D)."""

    def __init__(self, d_model: int):
        super().__init__()
        self.score = nn.Sequential(
            nn.Linear(d_model, d_model // 2), nn.Tanh(), nn.Linear(d_model // 2, 1)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        attn = torch.softmax(self.score(x), dim=1)  # (B, T, 1)
        return (attn * x).sum(dim=1)


class ConvModule(nn.Module):
    """Conformer-style convolution module: LN -> pw(2d)+GLU -> dw(k) -> BN -> SiLU -> pw -> drop."""

    def __init__(self, d_model: int, kernel_size: int = 15, dropout: float = 0.1):
        super().__init__()
        self.norm = nn.LayerNorm(d_model)
        self.pw1 = nn.Conv1d(d_model, 2 * d_model, kernel_size=1)
        self.dw = nn.Conv1d(
            d_model,
            d_model,
            kernel_size=kernel_size,
            padding=kernel_size // 2,
            groups=d_model,
        )
        self.bn = nn.BatchNorm1d(d_model)
        self.pw2 = nn.Conv1d(d_model, d_model, kernel_size=1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # (B, T, D)
        h = self.norm(x).transpose(1, 2)  # (B, D, T)
        h = F.glu(self.pw1(h), dim=1)
        h = F.silu(self.bn(self.dw(h)))
        h = self.pw2(h).transpose(1, 2)
        return self.dropout(h)


class FeedForward(nn.Module):
    def __init__(self, d_model: int, expansion: int = 4, dropout: float = 0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.LayerNorm(d_model),
            nn.Linear(d_model, expansion * d_model),
            nn.SiLU(),
            nn.Dropout(dropout),
            nn.Linear(expansion * d_model, d_model),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class MHSAModule(nn.Module):
    def __init__(self, d_model: int, num_heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.norm = nn.LayerNorm(d_model)
        self.attn = nn.MultiheadAttention(d_model, num_heads, dropout=dropout, batch_first=True)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.norm(x)
        h, _ = self.attn(h, h, h, need_weights=False)
        return self.dropout(h)


class SqueezeformerLiteBlock(nn.Module):
    """Pre-norm block: x + MHSA -> x + Conv -> x + FFN."""

    def __init__(
        self, d_model: int, num_heads: int = 4, conv_kernel: int = 15, dropout: float = 0.1
    ):
        super().__init__()
        self.mhsa = MHSAModule(d_model, num_heads, dropout)
        self.conv = ConvModule(d_model, conv_kernel, dropout)
        self.ffn = FeedForward(d_model, 4, dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.mhsa(x)
        x = x + self.conv(x)
        x = x + self.ffn(x)
        return x


class SqueezeformerLite(nn.Module):
    def __init__(
        self,
        num_classes: int,
        input_dim: int = 780,
        d_model: int = 128,
        num_layers: int = 4,
        num_heads: int = 4,
        conv_kernel: int = 15,
        dropout: float = 0.1,
        max_len: int = MAX_LEN,
    ):
        super().__init__()
        self.proj = nn.Sequential(
            nn.Linear(input_dim, d_model),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
        )
        self.pos_emb = nn.Parameter(torch.zeros(1, max_len, d_model))
        nn.init.trunc_normal_(self.pos_emb, std=0.02)
        self.blocks = nn.ModuleList(
            SqueezeformerLiteBlock(d_model, num_heads, conv_kernel, dropout)
            for _ in range(num_layers)
        )
        self.final_norm = nn.LayerNorm(d_model)
        self.pool = AttentionPooling(d_model)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(d_model, num_classes))

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # (B, T, input_dim)
        _b, T, _ = x.shape
        if T > self.pos_emb.size(1):
            raise ValueError(f"T={T} exceeds max_len={self.pos_emb.size(1)}")
        h = self.proj(x) + self.pos_emb[:, :T]
        for blk in self.blocks:
            h = blk(h)
        h = self.final_norm(h)
        h = self.pool(h)
        return self.head(h)


def build_model(name: str, num_classes: int, input_dim: int = 780, **kw) -> nn.Module:
    """models.py 의 factory 중 서빙에 쓰는 이름만 지원한다."""
    name = name.lower()
    if name == "small":
        kw.setdefault("d_model", 128)
        kw.setdefault("num_layers", 4)
        return SqueezeformerLite(num_classes, input_dim, **kw)
    if name == "small_cpu":
        kw.setdefault("d_model", 96)
        kw.setdefault("num_layers", 3)
        return SqueezeformerLite(num_classes, input_dim, **kw)
    raise ValueError(f"Unknown model name: {name!r} (expected small | small_cpu)")


# ---------------------------------------------------------------------------
# 체크포인트 로딩 + 추론 상태
# ---------------------------------------------------------------------------


@dataclass
class ModelState:
    loaded: bool = False
    model: nn.Module | None = None
    model_name: str = "small"
    model_version: str = "unloaded"  # 체크포인트 run 디렉토리 이름 (예: exp13_small_v2_f1)
    num_classes: int = VOCAB_SIZE
    # 클래스 인덱스 → 어휘 항목. 정본은 체크포인트 wrapper 의 class_labels 배열이다 —
    # 로드 시 vocab.py 의 sorted 규약과 교차 검증하고, 불일치면 로드 자체를 거부한다.
    class_entries: list[VocabEntry] = field(default_factory=lambda: CLASS_INDEX_TO_ENTRY)
    # temperature scaling (calibration.json). softmax 전에 logits 를 이 값으로 나눈다.
    temperature: float = 1.0
    # 체크포인트 wrapper 의 use_z — 전처리 z 분기(preprocess_eval)의 유일한 입력.
    # False = z 를 0 으로 고정하고 학습한 모델 (exp15 z-off, 핸드오프 09 §2).
    use_z: bool = True
    error: str | None = None

    def predict_probs(self, x: np.ndarray) -> np.ndarray:
        """(T, 780) float32 → 캘리브레이션된 softmax 확률 (num_classes,)."""
        assert self.model is not None
        with torch.no_grad():
            logits = self.model(torch.from_numpy(x).unsqueeze(0))  # (1, C)
            return torch.softmax(logits / self.temperature, dim=-1).squeeze(0).numpy()


def resolve_checkpoint_path() -> Path:
    """설정의 체크포인트 경로를 api 패키지 루트 기준 절대경로로 해석한다."""
    return _resolve(settings.model_checkpoint_path)


def resolve_calibration_path() -> Path:
    """설정의 캘리브레이션 경로를 api 패키지 루트 기준 절대경로로 해석한다."""
    return _resolve(settings.model_calibration_path)


def _resolve(raw_path: str) -> Path:
    raw = Path(raw_path)
    if raw.is_absolute():
        return raw
    return (settings.package_root / raw).resolve()


def _load_temperature(expected_run: str | None = None) -> float:
    """calibration.json 의 temperature 를 읽는다. 없거나 깨졌으면 1.0 + 경고 로그.

    하드코딩 대신 파일 참조 — 캘리브레이션 재산출 시 파일 교체만으로 반영되게 한다.

    파일 형식 (모델 레포 산출물 실측, 2026-08-10):
      - 현행: {"current": {"run": ..., "temperature": ...}, "previous_...": {...}} —
        z-off 전환(핸드오프 09)과 함께 이력 보존형으로 바뀌었다. current 만 읽는다.
      - 구형(평면): {"temperature": ...} — 하위 호환으로 유지 (재현 실험용 임시 파일 등).

    expected_run: 체크포인트 run 디렉토리 이름. current.run 과 다르면 경고 로그 —
    다른 모델용 temperature 를 조용히 쓰는 사고를 드러내되, 캘리브레이션은 원래
    베스트 에포트(부재 시 1.0)이므로 로드를 막지는 않는다.
    """
    path = resolve_calibration_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        entry = data["current"] if isinstance(data.get("current"), dict) else data
        temperature = float(entry["temperature"])
        if not (0.0 < temperature < 100.0):
            raise ValueError(f"temperature out of range: {temperature}")
        run = entry.get("run")
        if expected_run is not None and run is not None and run != expected_run:
            logger.warning(
                "calibration run mismatch: calibration.json current.run=%r vs checkpoint "
                "run=%r — 다른 모델용 temperature 일 수 있다. 모델 레포 캘리브레이션 "
                "재산출 여부를 확인할 것",
                run,
                expected_run,
            )
        logger.info("calibration loaded: temperature=%.4f from %s", temperature, path)
        return temperature
    except Exception as exc:  # noqa: BLE001 — 캘리브레이션 부재는 로드를 막지 않는다
        logger.warning(
            "calibration load failed (%s): %s — temperature=1.0 (uncalibrated) 로 진행", path, exc
        )
        return 1.0


def _resolve_class_entries(class_labels: object) -> list[VocabEntry]:
    """체크포인트 내장 class_labels 를 어휘 매핑의 정본으로 해석한다.

    vocab.py 의 sorted 규약(CLASS_INDEX_TO_ENTRY)과 교차 검증해 불일치면 예외를
    던진다(= 로드 거부). 라벨 인덱스가 어긋난 채 서빙되면 조용히 전부 오답이 된다.
    """
    if not isinstance(class_labels, (list, tuple)):
        raise TypeError(f"checkpoint class_labels 형식 불일치: {type(class_labels).__name__}")
    labels = [str(x) for x in class_labels]
    unknown = [x for x in labels if x not in LABEL_TO_ENTRY]
    if unknown:
        raise ValueError(f"checkpoint class_labels 에 어휘에 없는 라벨: {unknown}")
    sorted_labels = [e.label for e in CLASS_INDEX_TO_ENTRY]
    if labels != sorted_labels:
        raise ValueError(
            "checkpoint class_labels 가 vocab.py 의 sorted 규약과 불일치 — 로드 거부. "
            f"checkpoint={labels} vs vocab={sorted_labels}"
        )
    return [LABEL_TO_ENTRY[x] for x in labels]


def _load_state() -> ModelState:
    path = resolve_checkpoint_path()
    try:
        # 체크포인트는 primitive + tensor 만 담고 있어 weights_only=True 로 안전하게 로드된다
        ckpt = torch.load(path, map_location="cpu", weights_only=True)

        if not (isinstance(ckpt, dict) and "state_dict" in ckpt):
            raise ValueError(
                "checkpoint 가 dict wrapper 형식이 아니다 — v2 서빙은 model/class_labels/"
                "preprocess_version 메타가 있는 wrapper 만 허용한다"
            )

        # dict wrapper (모듈 docstring 의 실측 구조 참조)
        state_dict = ckpt["state_dict"]
        model_name = str(ckpt.get("model", "small"))
        num_classes = int(ckpt.get("num_classes", VOCAB_SIZE))
        trained_t = int(ckpt.get("T", TARGET_T))

        # 전처리 버전 게이트 — 구모델+신전처리(또는 그 반대) 조합 사고 방지 (핸드오프 §3-2).
        # 필드가 없는 구형(v1) 체크포인트는 "1" 로 간주해 거부한다.
        ckpt_preprocess = str(ckpt.get("preprocess_version", "1"))
        if ckpt_preprocess != PREPROCESS_VERSION:
            raise ValueError(
                f"checkpoint preprocess_version={ckpt_preprocess!r} != 서버 "
                f"PREPROCESS_VERSION={PREPROCESS_VERSION!r} — 전처리와 가중치가 어긋난 "
                "조합은 서빙하지 않는다 (train/serve skew)"
            )

        # z 채널 계약 (핸드오프 09 §3-1) — use_z 값을 읽어 전처리 z 처리를 분기한다.
        # 필드가 아예 없는 체크포인트는 z 계약을 모르는 구형이므로 여전히 거부한다.
        if "use_z" not in ckpt:
            raise ValueError(
                "checkpoint 에 use_z 가 없다 — z 채널 계약을 명시하지 않는 구형 "
                "체크포인트는 서빙 대상이 아니다 (핸드오프 09_z_gap_response.md §3-1)"
            )
        use_z = bool(ckpt["use_z"])

        if num_classes != VOCAB_SIZE:
            raise ValueError(
                f"checkpoint num_classes={num_classes} != vocab size {VOCAB_SIZE} — "
                "어휘와 모델이 어긋났다. vocab.py 와 체크포인트를 함께 확인할 것"
            )
        if trained_t != TARGET_T:
            raise ValueError(f"checkpoint T={trained_t} != preprocess TARGET_T={TARGET_T}")

        # 어휘 매핑 정본 = 내장 class_labels (vocab.py sorted 규약과 교차 검증)
        if "class_labels" not in ckpt:
            raise ValueError(
                "checkpoint 에 class_labels 가 없다 — v2 서빙은 내장 라벨을 어휘 매핑의 "
                "정본으로 요구한다 (구형 체크포인트는 서빙 대상이 아니다)"
            )
        class_entries = _resolve_class_entries(ckpt["class_labels"])
        if len(class_entries) != num_classes:
            raise ValueError(
                f"checkpoint class_labels 길이 {len(class_entries)} != num_classes {num_classes}"
            )

        model = build_model(model_name, num_classes)
        model.load_state_dict(state_dict, strict=True)
        model.eval()

        state = ModelState(
            loaded=True,
            model=model,
            model_name=model_name,
            model_version=path.parent.name,  # run 디렉토리 이름을 버전으로 사용
            num_classes=num_classes,
            class_entries=class_entries,
            temperature=_load_temperature(expected_run=path.parent.name),
            use_z=use_z,
        )
        logger.info(
            "model loaded: %s (%s, preprocess_version=%s, use_z=%s, temperature=%.4f) from %s",
            model_name,
            state.model_version,
            ckpt_preprocess,
            state.use_z,
            state.temperature,
            path,
        )
        return state
    except Exception as exc:  # noqa: BLE001 — 서버는 뜨되 /recognize 만 503
        logger.warning("model load failed (%s): %s", path, exc)
        return ModelState(loaded=False, error=str(exc))


_state: ModelState | None = None


def get_model_state() -> ModelState:
    """지연 로딩 싱글턴. 첫 호출 시 체크포인트를 읽는다."""
    global _state
    if _state is None:
        _state = _load_state()
    return _state


def reset_model_state() -> None:
    """테스트 전용: 다음 get_model_state() 가 다시 로드하게 한다."""
    global _state
    _state = None
