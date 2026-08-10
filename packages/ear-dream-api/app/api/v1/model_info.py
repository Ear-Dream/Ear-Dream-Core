"""/model — 서빙 모델·전처리·계약 정보. 클라이언트가 계약(프레임 수 등)을 내려받는 곳."""

from fastapi import APIRouter

from app.core.config import settings
from app.ml.model import get_model_state
from app.ml.preprocess import PREPROCESS_VERSION
from app.ml.sentence_rules import RULESET_VERSION
from app.ml.vocab import VOCAB_VERSION
from app.schemas.landmark import HAND_POINT_COUNT, POSE_POINT_COUNT
from app.schemas.system import LandmarkContract, ModelInfo

router = APIRouter(tags=["model"])


@router.get("/model", response_model=ModelInfo)
def get_model_info() -> ModelInfo:
    state = get_model_state()
    return ModelInfo(
        model_loaded=state.loaded,
        model_name=state.model_name,
        model_version=state.model_version,
        num_classes=state.num_classes,
        top_k=settings.recognize_top_k,  # 임시값 — 실측 후 확정
        reject_threshold=settings.reject_threshold,  # 임시값 — 실측 후 확정
        preprocess_version=PREPROCESS_VERSION,
        vocab_version=VOCAB_VERSION,
        ruleset_version=RULESET_VERSION,
        landmark_contract=LandmarkContract(
            hand_point_count=HAND_POINT_COUNT,
            face_point_counts=settings.face_point_counts,
            pose_point_count=POSE_POINT_COUNT,
            min_frames=settings.min_frames,  # 임시값 — 실측 후 확정
            max_frames=settings.max_frames,  # 임시값 — 실측 후 확정
            face_required=False,
            pose_required=False,
        ),
    )
