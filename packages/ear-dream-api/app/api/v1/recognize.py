from fastapi import APIRouter

from app.schemas.recognition import RecognitionResult, RecognizeRequest

router = APIRouter(tags=["recognize"])


@router.post("/recognize", response_model=RecognitionResult)
def recognize(request: RecognizeRequest) -> RecognitionResult:
    return RecognitionResult(candidates=[], window_ms=0)
