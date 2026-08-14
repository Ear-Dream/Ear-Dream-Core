"""/speech 요청 스키마 — 문장 + 감정·말투 → WAV.

응답은 Pydantic 모델이 아니라 **`audio/wav` 바이트**다 (라우트 참조). 그래서 여기에는
요청 모델만 있다.
"""

from pydantic import BaseModel, Field, field_validator

from app.schemas.sentence import SentenceEmotion, SentenceStyle


class SpeechRequest(BaseModel):
    """읽을 문장과 태그.

    `emotion`/`style` 은 `/compose-sentence` 응답(`source="model"`)의 태그를 그대로
    넘기면 된다. 규칙 경로라 태그가 null 이면 생략하고 기본값(neutral/normal)으로 읽는다.

    TTS 엔진 자체는 말투 7종을 지원하지만(instructions.py) 여기서는 문장 LLM 이 실제로
    내는 `SentenceStyle` 4종만 받는다 — 클라이언트가 만들어낼 수 없는 값을 계약에
    넣지 않는다.
    """

    text: str = Field(min_length=1, max_length=4096)
    emotion: SentenceEmotion = SentenceEmotion.neutral
    style: SentenceStyle = SentenceStyle.normal

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value
