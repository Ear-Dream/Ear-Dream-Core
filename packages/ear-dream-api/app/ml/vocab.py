"""서빙 어휘 300단어 — SPOTER-208 pilot300 (AIHub 일상 고빈도 핵심단어 300).

데이터 정본은 `app/ml/data/vocab300.json` 이다 — 벤치마크 레포의 `data/classes.json`
(WORDxxxx → class index) + `일상_고빈도_핵심단어_300.csv`(원본 단어 번호 → 한국어 단어)에서
`scripts/build_spoter300_bundle.py` 가 생성한다. 손으로 수정하지 말고 스크립트로 재생성할 것.

## 클래스 인덱스 ↔ 어휘 매핑 근거 (v2 sorted 규약에서 변경됨)

v2(30단어)는 학습 코드의 `sorted(단어)` 를 재현했지만, SPOTER-208 은 classes.json 이
인덱스를 **명시적으로** 정의한다 (정렬 규약 아님 — WORD1157→0, WORD1351→1, ...).
vocab300.json 의 각 항목이 `class_index` 를 그대로 싣고, CLASS_INDEX_TO_ENTRY 는 그
순서로 배열된다. 서빙 번들 release.json 의 `class_labels` 와 로드 시 교차 검증하며
(app/ml/model.py), 불일치면 로드를 거부한다 — 여기가 틀리면 조용히 전부 오답이 된다.

어휘 ID 는 기존 체계 유지: `w_{aihub 번호 4자리}` (예: "w_1157", "w_0003").
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent / "data" / "vocab300.json"
_DATA = json.loads(_DATA_PATH.read_text(encoding="utf-8"))

VOCAB_VERSION: str = str(_DATA["vocab_version"])


@dataclass(frozen=True)
class VocabEntry:
    id: str  # "w_1157"
    label: str  # "나"
    aihub_word_id: str  # "1157" (NIA_SL_WORD1157)
    class_index: int  # 모델 출력 인덱스 (classes.json 정본)
    korean_aliases: tuple[str, ...] = field(default=())


ENTRIES: list[VocabEntry] = [
    VocabEntry(
        id=str(raw["id"]),
        label=str(raw["label"]),
        aihub_word_id=str(raw["aihub_word_id"]),
        class_index=int(raw["class_index"]),
    )
    for raw in _DATA["entries"]
]

VOCAB_SIZE = len(ENTRIES)

# 생성 스크립트가 이미 검증하지만, 데이터 파일이 손으로 편집되는 사고까지 막는 방어선
assert VOCAB_SIZE == 300, f"vocab300.json 항목 수 {VOCAB_SIZE} != 300"
assert len({e.id for e in ENTRIES}) == VOCAB_SIZE, "어휘 ID 중복"
assert len({e.label for e in ENTRIES}) == VOCAB_SIZE, "한국어 라벨 중복 (인덱스 매핑 유일성 붕괴)"
assert sorted(e.class_index for e in ENTRIES) == list(range(VOCAB_SIZE)), (
    "class_index 가 0..299 전단사가 아니다"
)

# 클래스 인덱스 순 배열 — classes.json 이 정의한 명시적 인덱스 (모듈 docstring 참조)
CLASS_INDEX_TO_ENTRY: list[VocabEntry] = sorted(ENTRIES, key=lambda e: e.class_index)

ID_TO_ENTRY: dict[str, VocabEntry] = {e.id: e for e in ENTRIES}
LABEL_TO_ENTRY: dict[str, VocabEntry] = {e.label: e for e in ENTRIES}
