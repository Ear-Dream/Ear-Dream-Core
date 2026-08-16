"""/sign-sequence — 청인 문장을 아바타가 재생할 단어 시퀀스로 바꾼다.

청인→농인 트랙(STT 문장 → 단어 시퀀스 → 아바타 재생)의 서버 절반이다.
`/compose-sentence`(단어열 → 문장)의 정확한 역방향.

## 이름에 대해

`/compose-sentence` 와 대칭이면 `/decompose-sentence` 가 자연스럽지만, 이 엔드포인트가
돌려주는 것은 "분해된 문장" 이 아니라 **재생 지시**(단어 순서 + 자산 키 + 재생 불가 사유)다.
클라이언트가 이걸 받아서 하는 일이 문장 분석이 아니라 시퀀스 재생이므로, 결과물을
가리키는 `/sign-sequence` 를 골랐다.

## 두 단계, 두 종류의 실패

1. **문장 → 단어 ID** (`app/ml/sentence_decompose`) — 실패하면 `unknown_word`.
   지금은 규칙 mock 이다. 진짜 변환 모델이 붙으면 그 앞에 들어가고 이 규칙은 폴백으로
   남는다 (`/compose-sentence` 의 LLM → 규칙 구조와 같다).
2. **단어 ID → 재생 자산** (`app/ml/sign_sequences`) — 실패하면 `no_sequence`.
   현재 어휘 300 중 41단어만 시퀀스가 있어 대부분이 여기서 걸린다.

두 실패를 **섞지 않는 것이 이 API 의 요점**이다 (schemas 의 SignSequenceIssue 주석).

## 왜 200 인가

재생 불가 항목이 있어도 200 이다. 이 응답은 "문장 전체가 되냐 안 되냐" 가 아니라
"어느 단어가 왜 안 되냐" 를 전달해야 하고, 그 정보는 본문에만 담을 수 있다.
HTTPException 은 `{"detail": ...}` 하나뿐이라 항목별 사유를 실을 자리가 없다.
422 는 **분해할 내용 자체가 없는 입력**(공백뿐)에만 쓴다 — Pydantic 이 처리한다.
"""

import time
from typing import Annotated

from fastapi import APIRouter, Body

from app.core.logging import get_logger
from app.ml.sentence_decompose import DECOMPOSE_RULESET_VERSION, decompose
from app.ml.sign_sequences import (
    SEQUENCE_ASSET_PATH,
    SEQUENCE_BUNDLE_VERSION,
    SEQUENCE_SOURCE_FPS,
    SEQUENCES,
)
from app.ml.vocab import ID_TO_ENTRY
from app.schemas.sign_sequence import (
    SignSequenceIssue,
    SignSequenceItem,
    SignSequenceRequest,
    SignSequenceResult,
    SignSequenceSource,
)

logger = get_logger("sign_sequence")

router = APIRouter(tags=["sign-sequence"])

# Swagger(/docs) 요청 예시 — 실제 역인덱스·시퀀스 매니페스트 기준.
_SIGN_SEQUENCE_EXAMPLES = {
    "template_playable": {
        "summary": "템플릿 적중 — 전 단어 재생 가능",
        "description": (
            '"밥을 부탁해요" 는 _MULTI 템플릿의 우변이라 역인덱스에 적중해 '
            "[w_1534(밥), w_1589(부탁)] 로 분해되고, 두 단어 모두 시퀀스가 있다."
        ),
        "value": {
            "session_id": "docs-demo",
            "request_id": "docs-seq-template",
            "text": "밥을 부탁해요",
        },
    },
    "no_sequence": {
        "summary": "어휘엔 있으나 시퀀스가 없다",
        "description": (
            '"나" 는 어휘 300에 있지만(w_1157) 아바타 시퀀스가 없는 259단어에 속해 '
            '`issue="no_sequence"` 가 붙는다.'
        ),
        "value": {"session_id": "docs-demo", "request_id": "docs-seq-nosseq", "text": "나"},
    },
    "unknown_word": {
        "summary": "어휘에 없는 단어",
        "description": (
            '"컴퓨터" 는 어휘 300에 없어 `issue="unknown_word"` 다. '
            '조사가 붙은 토큰("밥을")도 형태소 분석을 하지 않으므로 여기로 온다 '
            "— sentence_decompose 모듈 주석 참조."
        ),
        "value": {"session_id": "docs-demo", "request_id": "docs-seq-unknown", "text": "컴퓨터"},
    },
}


@router.post("/sign-sequence", response_model=SignSequenceResult)
def build_sign_sequence(
    request: Annotated[SignSequenceRequest, Body(openapi_examples=_SIGN_SEQUENCE_EXAMPLES)],
) -> SignSequenceResult:
    started = time.perf_counter()

    # 1단계: 문장 → 단어 ID (규칙 mock — 모듈 주석)
    decomposed, source = decompose(request.text)

    # 2단계: 단어 ID → 재생 자산. 어휘 판정(1단계)이 항상 먼저다 —
    # `/compose-sentence` 가 LLM 보다 어휘 검증을 먼저 하는 것과 같은 순서다.
    items: list[SignSequenceItem] = []
    for source_text, word_id in decomposed:
        if word_id is None:
            items.append(
                SignSequenceItem(source_text=source_text, issue=SignSequenceIssue.unknown_word)
            )
            continue
        entry = ID_TO_ENTRY[word_id]
        sequence = SEQUENCES.get(word_id)
        if sequence is None:
            items.append(
                SignSequenceItem(
                    source_text=source_text,
                    word_id=word_id,
                    label=entry.label,
                    issue=SignSequenceIssue.no_sequence,
                )
            )
            continue
        items.append(
            SignSequenceItem(
                source_text=source_text,
                word_id=word_id,
                label=entry.label,
                sequence_key=sequence.sequence_key,
                frame_count=sequence.frame_count,
            )
        )

    playable = bool(items) and all(item.issue is None for item in items)

    blocked = [f"{item.source_text}:{item.issue.value}" for item in items if item.issue is not None]
    logger.info(
        'sign-sequence req=%s sess=%s text="%s" source=%s items=%d playable=%s%s latency_ms=%.1f',
        request.request_id,
        request.session_id,
        request.text,
        source,
        len(items),
        playable,
        f" blocked=[{','.join(blocked)}]" if blocked else "",
        (time.perf_counter() - started) * 1000.0,
    )

    return SignSequenceResult(
        request_id=request.request_id,
        text=request.text,
        source=SignSequenceSource(source),
        items=items,
        playable=playable,
        asset_path=SEQUENCE_ASSET_PATH,
        source_fps=SEQUENCE_SOURCE_FPS,
        sequence_bundle_version=SEQUENCE_BUNDLE_VERSION,
        ruleset_version=DECOMPOSE_RULESET_VERSION,
    )
