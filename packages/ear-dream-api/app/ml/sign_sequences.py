"""아바타 재생 시퀀스 매니페스트 — "이 단어에 재생할 시퀀스가 있는가".

데이터 정본은 `app/ml/data/sign_sequences.json` 이고 `scripts/build_sign_sequences.py` 가
생성한다. 손으로 수정하지 말고 스크립트로 재생성할 것 (vocab300.json 과 같은 관례).

**좌표는 여기 없다.** 좌표는 클라이언트 빌트인 자산(`packages/ear-dream-app/public/
sign-sequences/`)으로 가고 서버는 목록만 안다. 서버가 매번 좌표를 내려보내면
단어당 60 KiB 가 응답에 실려 ngrok 대역폭을 먹는다.

서버가 이 목록을 갖는 이유는 하나다: `/sign-sequence` 가 **`no_sequence`(어휘엔 있으나
아바타 시퀀스가 없다)** 를 `unknown_word`(어휘 자체에 없다) 와 구분해서 답하려면
"어떤 단어에 시퀀스가 있는지" 를 알아야 한다. 현재는 어휘 300 전부에 시퀀스가 있지만,
어휘가 자산보다 먼저 늘어나는 것이 정상적인 순서라 이 구분은 남는다.

⚠️ **매니페스트와 앱 자산은 어긋날 수 있다.** 둘 다 커밋되지만 생성 스크립트가 한 번에
만들 뿐, 한쪽만 되돌리거나 머지에서 갈릴 수 있다. 그러면 서버는 "재생 가능" 이라 답하는데
클라이언트에 파일이 없는 상태가 된다. 양쪽 `bundle_version` 을 비교해 감지한다 — 응답
(`sequence_bundle_version`)과 index.json 에 같은 값이 실린다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.ml.vocab import ID_TO_ENTRY

_DATA_PATH = Path(__file__).resolve().parent / "data" / "sign_sequences.json"
_DATA = json.loads(_DATA_PATH.read_text(encoding="utf-8"))

SEQUENCE_BUNDLE_VERSION: str = str(_DATA["bundle_version"])

# 클라이언트가 자산을 찾아가는 기준 경로 (앱 public/ 하위 디렉토리명).
# 응답에 실어 서버·앱 어느 쪽이 경로를 바꿔도 계약으로 드러나게 한다.
SEQUENCE_ASSET_PATH: str = str(_DATA["asset_path"])

# 원본 영상 fps — 클라이언트 재생 속도 기준. ⚠️ 전처리 계약 문서 인용값이지
# 이 레포에서 실측한 값이 아니다 (build_sign_sequences.py 「fps」 절).
SEQUENCE_SOURCE_FPS: float = float(_DATA["source_fps"])


@dataclass(frozen=True)
class SequenceEntry:
    word_id: str
    # 클라이언트가 빌트인 자산을 찾아가는 키. 현재 값은 word_id 와 같지만 **별도 필드로
    # 유지한다** — 나중에 한 단어에 조음 변형(variant)이 여러 개 생기거나 자산 이름
    # 체계가 바뀌어도 어휘 ID 는 그대로여야 하기 때문이다. 클라이언트는 word_id 로
    # 파일명을 조립하지 말고 이 키를 쓴다.
    sequence_key: str
    frame_count: int


_RAW_SEQUENCES = _DATA["sequences"]

SEQUENCES: dict[str, SequenceEntry] = {
    str(raw["word_id"]): SequenceEntry(
        word_id=str(raw["word_id"]),
        sequence_key=str(raw["sequence_key"]),
        frame_count=int(raw["frame_count"]),
    )
    for raw in _RAW_SEQUENCES
}

SEQUENCE_COUNT = len(SEQUENCES)

# 매니페스트가 손으로 편집되는 사고까지 막는 방어선 (vocab.py 와 같은 취지)
assert SEQUENCE_COUNT == len(_RAW_SEQUENCES), "sign_sequences.json word_id 중복"
_orphans = sorted(set(SEQUENCES) - set(ID_TO_ENTRY))
assert not _orphans, f"어휘에 없는 단어의 시퀀스가 있다 (어휘 판본 불일치?): {_orphans}"


def has_sequence(word_id: str) -> bool:
    return word_id in SEQUENCES
