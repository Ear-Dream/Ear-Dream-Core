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
    model = "model"  # 문장 변환 모델 (미도입 — 예약)
    word_list = "word_list"  # 템플릿 없음: 라벨 공백 연결 fallback


class SentenceCandidate(BaseModel):
    text: str
    word_ids: list[str]
    source: SentenceSource


class SentenceResult(BaseModel):
    request_id: str
    candidates: list[SentenceCandidate] = Field(min_length=1)
    ruleset_version: str
