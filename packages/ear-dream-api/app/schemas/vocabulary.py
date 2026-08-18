"""/vocabulary 응답 스키마 — 서버가 인식할 수 있는 어휘 카탈로그."""

from pydantic import BaseModel, Field


class GlossRef(BaseModel):
    source: str = Field(description='출처 (예: "aihub-nia-sl")')
    gloss_id: str = Field(description='출처 내 식별자 (예: "NIA_SL_WORD1510")')
    url: str | None = None


class VocabularyEntry(BaseModel):
    id: str = Field(description='어휘 ID, 예: "w_1510"')
    label: str = Field(description='대표 표기, 예: "꿈"')
    korean_aliases: list[str] = Field(default_factory=list)
    gloss_refs: list[GlossRef] = Field(default_factory=list)
    has_avatar: bool = Field(
        description="아바타 재생 시퀀스 보유 여부. 어휘에 있어도 시퀀스가 없을 수 있다 "
        "(현재 300단어 전부 보유)"
    )
    avatar_sequence_key: str | None = Field(
        default=None,
        description="클라이언트 빌트인 시퀀스 키 (= sign_sequences 의 sequence_key). "
        "word_id 로 파일명을 조립하지 말고 이 값을 쓴다. has_avatar=false 면 null",
    )


class VocabularyCatalog(BaseModel):
    vocab_version: str
    entries: list[VocabularyEntry]
