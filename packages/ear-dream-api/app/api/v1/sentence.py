"""/compose-sentence — 누적된 단어 ID 열을 자연스러운 문장으로 변환한다."""

import time
from typing import Annotated

from fastapi import APIRouter, Body, HTTPException

from app.core.logging import get_logger
from app.ml.sentence_rules import RULESET_VERSION, compose
from app.ml.vocab import ID_TO_ENTRY
from app.schemas.sentence import (
    ComposeSentenceRequest,
    SentenceCandidate,
    SentenceResult,
    SentenceSource,
)

logger = get_logger("sentence")

router = APIRouter(tags=["sentence"])

# Swagger(/docs) 요청 예시 — 규칙(_MULTI 템플릿)의 실제 항목 기준.
# 템플릿 카탈로그는 app/ml/sentence_rules.py 참조.
_COMPOSE_EXAMPLES = {
    "template_hit": {
        "summary": "템플릿 적중 — 밥+부탁",
        "description": (
            '["w_1534"(밥), "w_1589"(부탁)] 은 조합 템플릿에 있어 '
            '`source="template"` 으로 "밥을 부탁해요" 가 나온다.'
        ),
        "value": {
            "session_id": "docs-demo",
            "request_id": "docs-compose-template",
            "word_ids": ["w_1534", "w_1589"],
        },
    },
    "word_list_fallback": {
        "summary": "템플릿 없음 — word_list fallback",
        "description": (
            '["w_1510"(꿈), "w_1593"(기차)] 조합은 템플릿에 없으므로 문장을 지어내지 않고 '
            '라벨 공백 연결 `source="word_list"` 로 "꿈 기차" 가 나온다.'
        ),
        "value": {
            "session_id": "docs-demo",
            "request_id": "docs-compose-fallback",
            "word_ids": ["w_1510", "w_1593"],
        },
    },
}


@router.post("/compose-sentence", response_model=SentenceResult)
def compose_sentence(
    request: Annotated[ComposeSentenceRequest, Body(openapi_examples=_COMPOSE_EXAMPLES)],
) -> SentenceResult:
    started = time.perf_counter()
    unknown = [wid for wid in request.word_ids if wid not in ID_TO_ENTRY]
    if unknown:
        logger.info(
            "compose req=%s sess=%s words=[%s] 422 unknown_word_ids=[%s]",
            request.request_id,
            request.session_id,
            ",".join(request.word_ids),
            ",".join(unknown),
        )
        raise HTTPException(status_code=422, detail=f"unknown word ids: {unknown}")

    text, source = compose(request.word_ids)
    logger.info(
        'compose req=%s sess=%s words=[%s] source=%s text="%s" latency_ms=%.1f',
        request.request_id,
        request.session_id,
        ",".join(request.word_ids),
        source,
        text,
        (time.perf_counter() - started) * 1000.0,
    )
    return SentenceResult(
        request_id=request.request_id,
        candidates=[
            SentenceCandidate(
                text=text,
                word_ids=request.word_ids,
                source=SentenceSource(source),
            )
        ],
        ruleset_version=RULESET_VERSION,
    )
