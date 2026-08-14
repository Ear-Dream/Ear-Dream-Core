"""/compose-sentence — 누적된 단어 ID 열을 자연스러운 문장으로 변환한다.

경로는 두 개다.

1. **LLM** (`source="model"`) — Qwen3-4B / vLLM 2단계 (문장 생성 → 감정·말투 분류).
   `app/services/sentence_llm` (Ear-Dream-Gloss2Sentence 이식본).
2. **규칙** (`source="template"` / `"word_list"`) — `app/ml/sentence_rules`.

LLM 을 먼저 쓰고, 꺼져 있거나 실패하면 규칙으로 폴백한다. **폴백은 500 을 내지 않는다** —
vLLM 은 별도 머신에서 도는 외부 의존이라 그것 하나로 화면이 멈추면 안 되고, 규칙 경로는
문장을 지어내지 않는 안전한 최소 동작이기 때문이다 (word_list = 라벨 나열).
원본 레포는 502/503/504 로 실패를 노출했지만, 그쪽은 문장 변환 **전용** 서비스라
폴백할 곳이 없었다는 차이다.
"""

import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

from app.core.logging import get_logger
from app.ml.sentence_rules import RULESET_VERSION, compose
from app.ml.vocab import ID_TO_ENTRY
from app.schemas.sentence import (
    ComposeSentenceRequest,
    SentenceCandidate,
    SentenceResult,
    SentenceSource,
)
from app.services.sentence_llm import (
    SENTENCE_LLM_PROMPT_VERSION,
    LLMResponseError,
    SentenceGenerator,
    get_sentence_generator,
)

logger = get_logger("sentence")

router = APIRouter(tags=["sentence"])

# Swagger(/docs) 요청 예시 — 규칙(_MULTI 템플릿)의 실제 항목 기준.
# 템플릿 카탈로그는 app/ml/sentence_rules.py 참조.
# (LLM 이 켜져 있으면 같은 요청이 source="model" 로 응답할 수 있다 — 위 모듈 주석 참조.)
_COMPOSE_EXAMPLES = {
    "template_hit": {
        "summary": "템플릿 적중 — 밥+부탁",
        "description": (
            '["w_1534"(밥), "w_1589"(부탁)] 은 조합 템플릿에 있어 '
            'LLM 이 꺼져 있으면 `source="template"` 으로 "밥을 부탁해요" 가 나온다.'
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
async def compose_sentence(
    request: Annotated[ComposeSentenceRequest, Body(openapi_examples=_COMPOSE_EXAMPLES)],
    generator: Annotated[SentenceGenerator | None, Depends(get_sentence_generator)],
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

    # LLM 입력은 어휘 ID 가 아니라 사람이 읽는 라벨(gloss)이다 — 프롬프트가 그 형태로
    # 평가됐다 (원본 레포 tests/scenarios.json 도 한국어 라벨 열이다).
    glosses = [ID_TO_ENTRY[wid].label for wid in request.word_ids]

    candidate: SentenceCandidate | None = None
    llm_model: str | None = None
    llm_prompt_version: str | None = None
    llm_timings: dict[str, float] = {}

    if generator is not None:
        try:
            result = await generator.generate(glosses)
        except (httpx.HTTPError, LLMResponseError) as exc:
            # 연결 실패·타임아웃·HTTP 오류·출력 계약 위반 — 전부 규칙으로 폴백한다.
            # 사유는 남긴다: 폴백이 조용하면 vLLM 이 죽은 걸 아무도 모른다.
            logger.warning(
                "compose req=%s sess=%s llm_failed=%s: %s — 규칙으로 폴백",
                request.request_id,
                request.session_id,
                type(exc).__name__,
                exc,
            )
        else:
            candidate = SentenceCandidate(
                text=result.text,
                word_ids=request.word_ids,
                source=SentenceSource.model,
                emotion=result.emotion,
                style=result.style,
            )
            # 설정으로 갈릴 수 있으니 상수가 아니라 **실제 호출한 모델**을 싣는다
            llm_model = result.model
            llm_prompt_version = SENTENCE_LLM_PROMPT_VERSION
            llm_timings = result.timings_ms

    if candidate is None:
        text, source = compose(request.word_ids)
        candidate = SentenceCandidate(
            text=text, word_ids=request.word_ids, source=SentenceSource(source)
        )

    # 어떤 백엔드·모델이 이 문장을 만들었는지 로그에도 남긴다 (기계마다 갈리므로).
    detail = f" llm={llm_model}" if llm_model else ""
    detail += "".join(f" {name}_ms={value:.1f}" for name, value in llm_timings.items())
    logger.info(
        'compose req=%s sess=%s words=[%s] source=%s text="%s"%s latency_ms=%.1f',
        request.request_id,
        request.session_id,
        ",".join(request.word_ids),
        candidate.source.value,
        candidate.text,
        detail,
        (time.perf_counter() - started) * 1000.0,
    )
    return SentenceResult(
        request_id=request.request_id,
        candidates=[candidate],
        ruleset_version=RULESET_VERSION,
        llm_model=llm_model,
        llm_prompt_version=llm_prompt_version,
    )
