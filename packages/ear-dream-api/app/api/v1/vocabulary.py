"""/vocabulary — 서버가 인식할 수 있는 어휘 카탈로그."""

from fastapi import APIRouter

from app.ml.vocab import ENTRIES, VOCAB_VERSION
from app.schemas.vocabulary import GlossRef, VocabularyCatalog, VocabularyEntry

router = APIRouter(tags=["vocabulary"])


@router.get("/vocabulary", response_model=VocabularyCatalog)
def get_vocabulary() -> VocabularyCatalog:
    return VocabularyCatalog(
        vocab_version=VOCAB_VERSION,
        entries=[
            VocabularyEntry(
                id=e.id,
                label=e.label,
                korean_aliases=list(e.korean_aliases),
                gloss_refs=[
                    GlossRef(
                        source="aihub-nia-sl",
                        gloss_id=f"NIA_SL_WORD{e.aihub_word_id}",
                        url=None,
                    )
                ],
                has_avatar=False,  # 수어 아바타 미리보기는 MVP 이후
                avatar_asset_id=None,
            )
            for e in ENTRIES
        ],
    )
