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
2. `word_list` — 어절별로 **형태소를 분석해** 어휘 라벨과 대조. `/compose-sentence` 의
   word_list fallback(라벨을 공백으로 이어붙임)의 역연산이되, 조사·활용을 벗겨낸다.

## 형태소 분석기를 쓰는 이유 (v2, 2026-08-18)

v1 은 어절을 **완전 일치**로만 대조해서 "아기가"·"귀엽네요" 같은 평범한 입력이 전부
`unknown_word` 였다. 그때 형태소 분석기를 미룬 이유는 "검증되지 않은 규칙이 불어나는 것"
이었는데, 그 논거는 **손으로 쓴 규칙**에 대한 것이지 검증된 분석기에 대한 것이 아니다.

손 규칙으로는 실제로 안 된다는 근거: 어휘 300 의 용언 64개 중 **26개가 불규칙 활용**
이다 (ㅂ 16 · ㄷ 4 · ㄹ탈락 3 · 르 3). "귀여워요"·"추워요"·"걸어요"·"몰라요" 는 어간이
변형돼 접두 매칭으로 잡히지 않는다. kiwipiepy 는 이 어간 복원을 해 준다.

## 매칭은 문장 전체에서, 보고는 어절 단위로

매칭을 어절 안에 가두면 "이해 못 했어요" 의 "못"+"하" 처럼 띄어쓰기를 사이에 둔 한
단어를 놓친다. 그래서 문장 전체 형태소 열에서 찾는다. 반대로 **못 찾은 조각은 어절
단위로** 보고한다 — 형태소 단위로 보고하면 "먹었어요" 가 세 항목이 되어 응답을 사람이
읽을 수 없다.

## 이 모듈의 책임은 여기까지다

**한국어 활용형·조사를 어휘 라벨에 매칭하는 것**까지가 이 모듈의 몫이다. 수어 어순
재배열·조사 생략·비수지 문법은 형태소 분석으로 안 되고 `SignSequenceSource.model` 자리의
진짜 몫이다. 이 선을 긋지 않으면 "분해가 잘 돼야 한다" 가 끝없이 커진다.

알려진 한계 둘 (테스트로 고정해 두었다):

  - **복합동사** — 분석기가 "걸어가" 를 한 동사로 보고, 그건 어휘에 없다. 성분으로
    쪼개려면 별도 규칙이 필요한데 그건 위 경계 밖이다.
  - **오타·구어체 변형** — "귀욥네" 처럼 어간이 틀어진 입력은 분석기가 미등록어로
    본다. 자모 편집거리 폴백이 필요한 영역이라 지금은 다루지 않는다.
"""

from __future__ import annotations

import re
import unicodedata

from app.ml.sentence_rules import _MULTI, _SINGLE
from app.ml.vocab import ID_TO_ENTRY, LABEL_TO_ENTRY

# 역인덱스 판본. `sentence_rules.RULESET_VERSION` 과 별개로 둔다 — 정규화 규칙만 바뀌어도
# 분해 결과가 달라지므로 정방향 규칙셋과 수명이 같지 않다.
# v2: 어절 완전 일치 → 형태소 분석 (조사·활용 처리).
DECOMPOSE_RULESET_VERSION = "sentence-decompose-v2-2026-08-18"

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

    return _decompose_words(normalize(text)), "word_list"


# ------------------------------------------------------------------ 형태소 경로

# 어휘 라벨이 될 수 있는 형태소 태그.
#   체언류 — 라벨 그대로 ("아기", "밥")
#   용언류 — 어간 + "다" ("귀엽" → "귀엽다"). kiwipiepy 가 불규칙 어간을 복원해 준다.
#   XSV/XSA — 앞 어근·명사와 붙여 "…하다"/"…되다" ("공부" + "하" → "공부하다")
# 태그에 붙는 `-I`(불규칙)·`-R`(규칙) 접미는 떼고 본다.
_NOMINAL_TAGS = frozenset(
    {"NNG", "NNP", "NNB", "NR", "NP", "XR", "XPN", "SL", "SH", "SN", "MAG", "MAJ", "MM"}
)
_PREDICATE_TAGS = frozenset({"VV", "VA", "VX", "VCN"})
_DERIVATION_TAGS = frozenset({"XSV", "XSA"})

# 명사를 몇 개까지 붙여 볼 것인가 ("운전" + "면허" → "운전면허").
# 어휘 300 의 최장 라벨이 명사 3개를 넘지 않아 3 으로 둔다 — 늘리면 오탐만 는다.
_MAX_NOUN_JOIN = 3

_kiwi = None

# 어휘 라벨을 분석기 사용자 사전에 넣는다.
#
# 이 서비스의 어휘는 분야 사전이라 일반 말뭉치와 무게가 다르다. "농인" 이 대표적인데,
# **단독으로는 한 덩어리로 잡히지만 문장 안에서는 "농"(NNG) + "인"(XSN) 으로 쪼개진다.**
# 그래서 "라벨 하나만 돌려 보고 등록 여부를 정하는" 방식은 통하지 않는다 — 어휘 라벨은
# 전부 등록하고 가중치로 우선순위를 준다. 사용자 사전이 바로 이럴 때 쓰라고 있는 장치다.
#
# 용언은 등록하지 않는다. 활용까지 알아야 쓸모가 있는데 그건 분석기가 이미 알고 있고
# (불규칙 어간 복원이 이 경로의 핵심이다), 어설프게 명사로 등록하면 오히려 활용형이
# 깨진다.
_USER_DICT_MIN_LEN = 2

# 사용자 사전 가중치. 분야 어휘를 일반 분석보다 앞세우되, 무관한 문장을 왜곡할 만큼
# 크지 않은 값이다. 오탐 회귀는 tests/test_sign_sequence.py 의 오탐 케이스가 지킨다.
_USER_DICT_SCORE = 3.0


def _register_vocab_words(kiwi) -> list[str]:
    added: list[str] = []
    for label in LABEL_TO_ENTRY:
        if len(label) < _USER_DICT_MIN_LEN or label.endswith("다"):
            continue
        kiwi.add_user_word(label, "NNP", _USER_DICT_SCORE)
        added.append(label)
    return added


def _get_kiwi():
    """분석기는 첫 호출 때 만든다 — import 만으로 모델을 올리면 테스트·기동이 느려진다."""
    global _kiwi
    if _kiwi is None:
        from kiwipiepy import Kiwi

        kiwi = Kiwi()
        _register_vocab_words(kiwi)
        _kiwi = kiwi
    return _kiwi


def _base_tag(tag: str) -> str:
    return tag.split("-", 1)[0]


def _decompose_words(text: str) -> list[tuple[str, str | None]]:
    """형태소를 훑어 어휘 라벨을 찾는다.

    매칭은 **문장 전체의 형태소 열**에서 한다 — 어절 안에 가두면 "이해 못 했어요" 의
    "못"+"하" 처럼 띄어쓰기를 사이에 둔 한 단어를 놓친다.

    반대로 **못 찾은 조각은 어절 단위로 보고한다.** 형태소 단위로 보고하면 "먹었어요"
    가 "먹"·"었"·"어요" 세 항목이 되어 응답이 읽을 수 없게 된다. 응답은 "입력의 어디가
    막혔는가" 를 사람이 보고 알 수 있어야 한다.
    """
    if not text:
        return []

    tokens = list(_get_kiwi().tokenize(text))
    matches = _match_morphemes(text, tokens)

    # 매칭이 덮은 글자 범위 — 어절이 통째로 남았는지 판정하는 데 쓴다.
    covered: set[int] = set()
    for span_start, span_end, _ in matches:
        covered.update(range(span_start, span_end))

    items: list[tuple[int, str, str | None]] = [
        (span_start, text[span_start:span_end], word_id) for span_start, span_end, word_id in matches
    ]
    for start, end in _word_spans(text):
        if any(pos in covered for pos in range(start, end)):
            continue
        items.append((start, text[start:end], None))

    items.sort(key=lambda item: item[0])
    return [(surface, word_id) for _, surface, word_id in items]


def _word_spans(text: str) -> list[tuple[int, int]]:
    """공백으로 나눈 어절의 (시작, 끝) 오프셋. 원문 조각을 그대로 응답에 싣기 위해서다."""
    return [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]


def _match_morphemes(text: str, tokens: list) -> list[tuple[int, int, str]]:
    """형태소 열에서 어휘 라벨을 앞에서부터 최장 일치로 집어낸다. (시작, 끝, 어휘 ID).

    못 찾은 형태소는 버린다 — 조사·어미는 애초에 어휘에 없고, 어휘에 없는 명사 하나
    때문에 같은 문장의 다른 단어까지 놓치면 안 된다.
    """
    found: list[tuple[int, int, str]] = []
    i = 0
    while i < len(tokens):
        matched = _match_at(tokens, i)
        if matched is None:
            i += 1
            continue
        entry_id, length = matched
        last = tokens[i + length - 1]
        found.append((tokens[i].start, last.start + last.len, entry_id))
        i += length
    return found


def _match_at(tokens: list, i: int) -> tuple[str, int] | None:
    """`tokens[i]` 에서 시작하는 어휘 라벨을 찾는다. (어휘 ID, 소비한 형태소 수)."""
    tag = _base_tag(tokens[i].tag)

    if tag in _NOMINAL_TAGS:
        # 명사 연쇄 최장 일치 — 짧은 쪽부터 잡으면 "운전면허" 가 "운전" 으로 끊긴다.
        for length in range(min(_MAX_NOUN_JOIN, len(tokens) - i), 0, -1):
            span = tokens[i : i + length]
            if not all(_base_tag(t.tag) in _NOMINAL_TAGS for t in span):
                continue
            entry = LABEL_TO_ENTRY.get("".join(t.form for t in span))
            if entry is not None:
                return entry.id, length
        # 앞 형태소와 붙어 한 용언이 되는 경우 — "피곤"+"하"(XSA) → 피곤하다,
        # "잘"+"하"(VV) → 잘하다. 분석기가 파생접미사로 볼지 용언으로 볼지 갈리므로
        # 둘 다 본다. **붙인 결과가 어휘 라벨일 때만** 받아들이므로 오탐은 어휘가 막는다.
        if i + 1 < len(tokens):
            next_tag = _base_tag(tokens[i + 1].tag)
            if next_tag in _DERIVATION_TAGS or next_tag in _PREDICATE_TAGS:
                entry = LABEL_TO_ENTRY.get(tokens[i].form + tokens[i + 1].form + "다")
                if entry is not None:
                    return entry.id, 2

    if tag in _PREDICATE_TAGS:
        entry = LABEL_TO_ENTRY.get(tokens[i].form + "다")
        if entry is not None:
            return entry.id, 1

    return None
