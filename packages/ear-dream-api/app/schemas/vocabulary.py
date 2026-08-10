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
    has_avatar: bool = Field(description="수어 아바타 미리보기 영상 보유 여부 (MVP 이후)")
    avatar_asset_id: str | None = None


class VocabularyCatalog(BaseModel):
    vocab_version: str
    entries: list[VocabularyEntry]
