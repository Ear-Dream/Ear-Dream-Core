"""/compose-sentence 요청·응답 스키마 — 누적된 단어열을 자연스러운 문장으로 변환."""

from enum import Enum

from pydantic import BaseModel, Field


class ComposeSentenceRequest(BaseModel):
    session_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    word_ids: list[str] = Field(min_length=1, description='어휘 ID 열 (예: ["w_1534", "w_1589"])')
    source_request_ids: list[str] | None = Field(
        default=None, description="각 단어를 만든 /recognize request_id (추적용, 선택)"
    )


class SentenceSource(str, Enum):
    template = "template"  # 규칙 템플릿 적중
    model = "model"  # 문장 변환 LLM (Qwen3-4B / vLLM — app/services/sentence_llm)
    word_list = "word_list"  # 템플릿·LLM 모두 실패: 라벨 공백 연결 fallback


class SentenceEmotion(str, Enum):
    """문장에 표현된 감정. `source="model"` 일 때만 채워진다."""

    neutral = "neutral"
    happy = "happy"
    sad = "sad"
    angry = "angry"
    surprised = "surprised"
    fearful = "fearful"


class SentenceStyle(str, Enum):
    """문장의 종결형(말투). `source="model"` 일 때만 채워진다."""

    normal = "normal"  # 서술형 -다/-는다, 또는 불완전한 문장
    polite = "polite"  # 해요체
    casual = "casual"  # 해체(반말)
    formal = "formal"  # 하십시오체


class SentenceCandidate(BaseModel):
    text: str
    word_ids: list[str]
    source: SentenceSource
    # 감정·말투 태그는 LLM 2단계 분류(app/services/sentence_llm)의 산출물이다.
    # 규칙 템플릿·word_list 경로에는 분류기가 없으므로 null 이다 — 클라이언트는 없을 수
    # 있는 값으로 다뤄야 한다 (LLM 미가동 환경에서도 문장 자체는 항상 온다).
    emotion: SentenceEmotion | None = None
    style: SentenceStyle | None = None


class SentenceResult(BaseModel):
    request_id: str
    candidates: list[SentenceCandidate] = Field(min_length=1)
    ruleset_version: str
    # 어떤 LLM 이 만든 문장인지 (source="model" 일 때만). 미가동·폴백이면 null.
    llm_model: str | None = None
    # 프롬프트 판본 (app/services/sentence_llm/prompt.py). source="model" 일 때만.
    llm_prompt_version: str | None = None
