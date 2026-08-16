"""/vocabulary — 서버가 인식할 수 있는 어휘 카탈로그."""

from fastapi import APIRouter

from app.ml.sign_sequences import SEQUENCES
from app.ml.vocab import ENTRIES, VOCAB_VERSION
from app.schemas.vocabulary import GlossRef, VocabularyCatalog, VocabularyEntry

router = APIRouter(tags=["vocabulary"])


@router.get("/vocabulary", response_model=VocabularyCatalog)
def get_vocabulary() -> VocabularyCatalog:
    # 아바타 보유 여부의 정본은 sign_sequences 매니페스트 하나다 — /sign-sequence 가
    # no_sequence 를 판정하는 것과 같은 출처라 두 엔드포인트가 어긋나지 않는다.
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
                has_avatar=e.id in SEQUENCES,
                avatar_asset_id=(seq.sequence_key if (seq := SEQUENCES.get(e.id)) else None),
            )
            for e in ENTRIES
        ],
    )
