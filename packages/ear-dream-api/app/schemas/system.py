"""/health, /model 응답 스키마."""

from pydantic import BaseModel, ConfigDict, Field


class LandmarkContract(BaseModel):
    """클라이언트가 보내야 하는 랜드마크 계약. 서버 설정과 항상 일치해야 한다."""

    hand_point_count: int
    face_point_counts: list[int] = Field(description="허용 얼굴 점 개수 (모델 구성에 따라 468/478)")
    pose_point_count: int
    min_frames: int = Field(description="세그먼트 최소 프레임 수 — 미확정 임시값")
    max_frames: int = Field(description="세그먼트 최대 프레임 수 — 미확정 임시값")
    face_required: bool
    pose_required: bool


class ModelInfo(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_loaded: bool
    model_name: str
    model_version: str
    num_classes: int
    top_k: int = Field(description="후보 개수 — 미확정 임시값")
    reject_threshold: float = Field(description="rejected 판정 임계 — 미확정 임시값")
    preprocess_version: str
    vocab_version: str
    ruleset_version: str
    landmark_contract: LandmarkContract


class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    status: str
    model_loaded: bool
    vocab_size: int
