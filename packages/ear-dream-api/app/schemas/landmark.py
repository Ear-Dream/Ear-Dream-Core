"""랜드마크 프레임 스키마 — 프론트가 보내는 **가공하지 않은** 관측값 계약.

정규화·스케일링·결측치 대치는 전부 서버 전처리(app/ml)에서만 한다 (설계 결정 1).
손/얼굴/포즈는 전부 `number[][]` 라 구조적으로 동형이므로, 반드시 이름 있는 모델로
감싸서 생성 TS 타입에서도 구분되게 한다.
"""

from typing import Annotated

from annotated_types import Len
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.config import settings

# [x, y, z] 한 점. MediaPipe 정규화 좌표 그대로 (x/너비, y/높이) — 서버는 보정하지 않는다.
Point3 = Annotated[list[float], Len(3, 3)]

HAND_POINT_COUNT = 21
POSE_POINT_COUNT = 33


class HandObservation(BaseModel):
    """한 손의 관측값. handedness 는 MediaPipe 라벨 원본 그대로 보낸다.

    ⚠️ handedness 라벨은 앱에서 아직 실측 검증 전이다(HANDEDNESS_VERIFIED=false).
    서버는 포즈 손목 기하 매칭을 1순위로 쓰고 라벨은 fallback 으로만 쓴다.
    """

    handedness_label: str = Field(description='MediaPipe handedness 라벨 원본 ("Left"/"Right")')
    handedness_score: float = Field(ge=0, le=1)
    landmarks: list[Point3] = Field(description="손 21점 [x, y, z]")

    @field_validator("landmarks")
    @classmethod
    def _check_hand_points(cls, v: list[Point3]) -> list[Point3]:
        if len(v) != HAND_POINT_COUNT:
            raise ValueError(f"hand landmarks must have {HAND_POINT_COUNT} points, got {len(v)}")
        return v


class FaceObservation(BaseModel):
    """얼굴 메쉬 관측값. 점 개수는 MediaPipe 모델 구성에 따라 468 또는 478 이므로
    스키마에 개수를 박지 않고 서버 설정(face_point_counts)과 대조한다."""

    landmarks: list[Point3] = Field(description="얼굴 메쉬 전점 [x, y, z] (468 또는 478)")

    @field_validator("landmarks")
    @classmethod
    def _check_face_points(cls, v: list[Point3]) -> list[Point3]:
        if len(v) not in settings.face_point_counts:
            raise ValueError(
                f"face landmarks must have one of {settings.face_point_counts} points, got {len(v)}"
            )
        return v


class PoseObservation(BaseModel):
    """포즈 관측값 (MediaPipe Pose 33점). 어깨 기준 정규화와 손 좌우 배정에 쓰인다."""

    landmarks: list[Point3] = Field(description="포즈 33점 [x, y, z] (정규화 좌표)")
    visibility: list[float] = Field(description="포즈 33점 visibility (0~1)")
    world_landmarks: list[Point3] | None = Field(
        default=None, description="포즈 33점 world 좌표 (미터) — 선택"
    )

    @model_validator(mode="after")
    def _check_pose_points(self) -> "PoseObservation":
        if len(self.landmarks) != POSE_POINT_COUNT:
            raise ValueError(
                f"pose landmarks must have {POSE_POINT_COUNT} points, got {len(self.landmarks)}"
            )
        if len(self.visibility) != POSE_POINT_COUNT:
            raise ValueError(
                f"pose visibility must have {POSE_POINT_COUNT} values, got {len(self.visibility)}"
            )
        if self.world_landmarks is not None and len(self.world_landmarks) != POSE_POINT_COUNT:
            raise ValueError(
                f"pose world_landmarks must have {POSE_POINT_COUNT} points, "
                f"got {len(self.world_landmarks)}"
            )
        return self


class LandmarkFrame(BaseModel):
    """한 프레임의 관측값. face/pose 는 그 프레임의 관측값이며 검출 실패·스킵 시 null 이다.

    표시용 hold 값(displayFace 등)을 보내면 안 된다 — 결측치 대치는 서버 한 곳에서만 한다.
    """

    t_ms: float = Field(description="프레임 타임스탬프 (ms, 세그먼트 내 단조증가)")
    hands: list[HandObservation] = Field(
        default_factory=list, max_length=2, description="검출된 손 0~2개"
    )
    face: FaceObservation | None = None
    pose: PoseObservation | None = None
