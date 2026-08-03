from fastapi import APIRouter

from app.schemas.phrase import PresetPhrase

router = APIRouter(tags=["phrases"])


@router.get("/phrases", response_model=list[PresetPhrase])
def list_phrases(category: str | None = None) -> list[PresetPhrase]:
    return []
