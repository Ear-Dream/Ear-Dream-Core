"""서빙 어휘 30단어 — 모델 레포 `data/meta/word_gloss.csv`·`target_words.txt` 기준.

어휘 ID 는 AIHub(NIA) word_id 기반 `w_1510` 형식.

## 클래스 인덱스 ↔ 어휘 매핑 근거

모델 레포 `src/train.py` `load_manifest()` (lines 130~133):

    words = sorted(mf["word"].unique())
    word_to_id = {w: i for i, w in enumerate(words)}

즉 **클래스 인덱스 = manifest 의 한국어 단어 30개를 파이썬 기본 정렬(유니코드 코드포인트)한
순서**다. manifest.csv(status=ok)의 unique 단어 집합이 아래 30단어와 일치함을 실측 확인했다
(2026-08-08). CLASS_INDEX_TO_ENTRY 는 동일한 `sorted()` 를 재현해 만든다.
여기가 틀리면 조용히 전부 오답이 되므로, 어휘를 바꾸면 학습 라벨 순서부터 다시 확인할 것.
"""

from __future__ import annotations

from dataclasses import dataclass, field

VOCAB_VERSION = "ksl30-v2-2026-08-06"  # target_words.txt v2 (2026-08-06) 기준


@dataclass(frozen=True)
class VocabEntry:
    id: str  # "w_1510"
    label: str  # "꿈"
    aihub_word_id: str  # "1510" (NIA_SL_WORD1510)
    korean_aliases: tuple[str, ...] = field(default=())


# target_words.txt 순서 그대로 (aihub word_id, label)
_RAW: list[tuple[str, str, tuple[str, ...]]] = [
    ("1510", "꿈", ()),
    ("1514", "노래", ()),
    ("1515", "놀다", ("놀이",)),
    ("1519", "상처", ()),
    ("1522", "딸", ()),
    ("1528", "엄마", ("어머니",)),
    ("1530", "바쁘다", ()),
    ("1531", "남편", ()),
    ("1534", "밥", ("식사",)),
    ("1543", "세수", ()),
    ("1544", "자다", ("잠",)),
    ("1554", "피곤", ("피곤하다",)),
    ("1555", "양치", ("양치질",)),
    ("1565", "할머니", ()),
    ("1566", "할아버지", ()),
    ("1574", "형", ()),
    ("1576", "환자", ()),
    ("1577", "시작", ()),
    ("1581", "시험", ()),
    ("1589", "부탁", ()),
    ("1592", "회사", ()),
    ("1593", "기차", ()),
    ("1597", "상담", ()),
    ("1637", "없다", ()),
    ("2005", "아기", ()),
    ("2016", "어른", ()),
    ("2036", "목마르다", ("목마름",)),
    ("2108", "가루약", ()),
    ("2131", "물약", ()),
    ("2388", "돕다", ("도움",)),
]

ENTRIES: list[VocabEntry] = [
    VocabEntry(id=f"w_{wid}", label=label, aihub_word_id=wid, korean_aliases=aliases)
    for wid, label, aliases in _RAW
]

assert len(ENTRIES) == 30
assert len({e.id for e in ENTRIES}) == 30
assert len({e.label for e in ENTRIES}) == 30  # 정렬 매핑이 유일하려면 라벨 중복이 없어야 한다

# 클래스 인덱스 매핑: train.py load_manifest 의 sorted(unique words) 재현 (모듈 docstring 참조)
CLASS_INDEX_TO_ENTRY: list[VocabEntry] = sorted(ENTRIES, key=lambda e: e.label)

ID_TO_ENTRY: dict[str, VocabEntry] = {e.id: e for e in ENTRIES}
LABEL_TO_ENTRY: dict[str, VocabEntry] = {e.label: e for e in ENTRIES}

VOCAB_SIZE = len(ENTRIES)
