"""문장 → 단어열 분해 (규칙) — `/compose-sentence` 의 **역방향**.

청인→농인 방향에서 STT 문장을 아바타가 재생할 단어 시퀀스로 바꾸는 첫 단계다.

## 지금은 mock 이다. 그리고 진짜 모델이 붙어도 남는다.

문장→단어열 변환 모델은 아직 없다. 그래서 **`sentence_rules` 의 템플릿을 역인덱스로
뒤집어** 쓴다 — 팀이 이미 검증한 (단어열 ↔ 문장) 대응이라 임의로 지어낸 mock 보다
훨씬 낫고, `/compose-sentence` 와 왕복 일관성이 자동으로 보장된다.

진짜 모델이 붙으면 이 모듈은 **폴백**으로 남는다. `/compose-sentence` 가 LLM 실패 시
규칙으로 내려가는 구조와 같다 (그쪽 라우트 모듈 주석 참조) — 외부 LLM 하나 때문에
화면이 멈추면 안 되기 때문이다.

## 두 경로 (`/compose-sentence` 의 두 source 를 그대로 뒤집은 것)

1. `template` — 문장 전체가 역인덱스에 적중 (`_SINGLE`/`_MULTI` 의 우변).
2. `word_list` — 공백으로 쪼개 어휘 라벨과 대조. `/compose-sentence` 의 word_list
   fallback(라벨을 공백으로 이어붙임)의 정확한 역연산이다.

⚠️ **word_list 경로는 조사를 못 뗀다.** "밥을" 은 어휘 라벨 "밥" 과 매칭되지 않아
`unknown_word` 가 된다. 형태소 분석기를 넣지 않은 것은 의도다 — 여기서 한국어 조사
처리를 흉내 내기 시작하면 검증되지 않은 규칙이 계속 불어나고, 그건 진짜 모델이 할 일이다.
실제 STT 문장 대부분이 여기로 떨어지는 것이 **정상이고**, 응답이 어느 단어에서 왜
막혔는지 알려 주는 것이 현 단계의 목적이다.
"""

from __future__ import annotations

import re
import unicodedata

from app.ml.sentence_rules import _MULTI, _SINGLE
from app.ml.vocab import ID_TO_ENTRY, LABEL_TO_ENTRY

# 역인덱스 판본. `sentence_rules.RULESET_VERSION` 과 별개로 둔다 — 정규화 규칙만 바뀌어도
# 분해 결과가 달라지므로 정방향 규칙셋과 수명이 같지 않다.
DECOMPOSE_RULESET_VERSION = "sentence-decompose-v1-2026-08-16"

_TRAILING_PUNCT = ".!?。！？…~"


def normalize(text: str) -> str:
    """비교용 정규화 — NFC → 공백 정리 → 문말 부호 제거.

    STT 출력은 문말 부호가 붙기도 하고 안 붙기도 한다. 템플릿 우변("밥을 부탁해요")에는
    부호가 없으므로 여기서 떼어내지 않으면 적중률이 부호 유무에 좌우된다.
    """
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.rstrip(_TRAILING_PUNCT).strip()


def _key(text: str) -> str:
    """역인덱스 키 — 정규화 + 공백 제거.

    공백까지 지우는 이유: STT 는 띄어쓰기가 흔들린다("밥을 부탁해요" / "밥을부탁해요").
    한국어는 공백을 지워도 문자열 동일성 판정이 무너지지 않아 안전하다.
    """
    return normalize(text).replace(" ", "")


def _build_reverse_index() -> dict[str, tuple[str, ...]]:
    """`_SINGLE`/`_MULTI` 를 뒤집는다. **현재 어휘에 없는 단어를 쓰는 템플릿은 제외한다.**

    `_SINGLE`/`_MULTI` 는 v1 30단어 시절 항목이라 현재 300단어 어휘에 없는 ID 가 섞여
    있다 (sentence_rules 모듈 주석). 정방향은 라우트의 어휘 검증(422)이 먼저 걸러서
    죽은 항목이 발동하지 않지만, 역방향은 문장이 곧 입력이라 그 방어선이 없다 —
    여기서 걸러 두지 않으면 라벨 조회에서 KeyError 가 난다.
    실측: `_SINGLE` 30개 중 18개, `_MULTI` 21개 중 11개가 현재 어휘로 살아남는다.
    """
    index: dict[str, tuple[str, ...]] = {}
    collisions: list[str] = []

    def register(sentence: str, word_ids: tuple[str, ...]) -> None:
        if not all(wid in ID_TO_ENTRY for wid in word_ids):
            return  # 현재 어휘에 없는 단어를 쓰는 템플릿 — 재생 자체가 불가능하다
        key = _key(sentence)
        if key in index and index[key] != word_ids:
            collisions.append(sentence)
        index[key] = word_ids

    for word_id, sentence in _SINGLE.items():
        register(sentence, (word_id,))
    for word_ids, sentence in _MULTI.items():
        register(sentence, tuple(word_ids))

    # 같은 문장이 서로 다른 단어열로 두 번 등록되면 역방향이 비결정적이 된다 —
    # 정방향 템플릿을 고칠 때 여기서 즉시 드러나게 한다.
    assert not collisions, f"템플릿 우변 중복 — 역인덱스가 모호해진다: {collisions}"
    return index


_REVERSE: dict[str, tuple[str, ...]] = _build_reverse_index()

REVERSE_TEMPLATE_COUNT = len(_REVERSE)


def decompose(text: str) -> tuple[list[tuple[str, str | None]], str]:
    """문장 → ([(입력 조각, 어휘 ID 또는 None)], source).

    source ∈ {"template", "word_list"}. 어휘에 없는 조각은 word_id 가 None 이고,
    호출자가 `unknown_word` 로 보고한다. 시퀀스 보유 여부(`no_sequence`)는 여기서
    보지 않는다 — 어휘 판정과 자산 판정은 서로 다른 실패라서 분리해 둔다.
    """
    hit = _REVERSE.get(_key(text))
    if hit is not None:
        # 템플릿 경로에는 "입력의 어느 조각" 이라는 개념이 없다 (문장 전체가 한 덩어리로
        # 적중했다). 조각 자리에는 어휘 라벨을 넣어 응답이 사람 읽기 좋게 만든다.
        return [(ID_TO_ENTRY[wid].label, wid) for wid in hit], "template"

    tokens = normalize(text).split(" ")
    items: list[tuple[str, str | None]] = []
    for token in tokens:
        if not token:
            continue
        entry = LABEL_TO_ENTRY.get(token.rstrip(_TRAILING_PUNCT))
        items.append((token, entry.id if entry else None))
    return items, "word_list"
