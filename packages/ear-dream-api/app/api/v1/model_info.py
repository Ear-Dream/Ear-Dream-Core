"""/model — 서빙 모델·전처리·계약 정보. 클라이언트가 계약(프레임 수 등)을 내려받는 곳."""

from fastapi import APIRouter

from app.core.config import settings
from app.ml.model import get_model_state
from app.ml.preprocess_spoter import PREPROCESS_VERSION
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
        model_name=state.model_name,  # release.json (예: hybrid_208_h1b)
        model_version=state.model_version,  # 번들 이름 (예: hybrid300-h1b)
        num_classes=state.num_classes,
        top_k=settings.recognize_top_k,  # 임시값 — 실측 후 확정
        # 로드 시 확정된 임계 (release.json 권장값 또는 설정 오버라이드) — 임시값
        reject_threshold=state.reject_threshold,
        # = 전처리 계약의 feature_version (spoter2_mp_xy_v1)
        preprocess_version=PREPROCESS_VERSION,
        vocab_version=VOCAB_VERSION,
        ruleset_version=RULESET_VERSION,
        landmark_contract=LandmarkContract(
            hand_point_count=HAND_POINT_COUNT,
            # SPOTER-208 face 37 인덱스는 홍채(468·473) 포함 — 478점 메쉬 필수 (config 주석)
            face_point_counts=settings.face_point_counts,
            pose_point_count=POSE_POINT_COUNT,
            # 요청 페이로드 프레임 수 범위 — 임시값. SPOTER 전처리는 trim 없이 전 구간을
            # 쓰고 30fps 리샘플 후 256 초과분은 uniform sampling 으로 흡수한다 (config 주석)
            min_frames=settings.min_frames,
            max_frames=settings.max_frames,
            face_required=False,
            pose_required=False,
        ),
    )
