"""/recognize 요청·응답 스키마.

요청은 가공하지 않은 랜드마크 세그먼트(단어 하나 분량)를 그대로 담는다.
손 선택·정규화·보간은 전부 서버가 한다 (설계 결정 1).
"""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.config import settings
from app.schemas.landmark import LandmarkFrame


class BoundaryMode(str, Enum):
    """단어 경계를 자른 방식. 어떤 방식이 최종인지는 미확정이라 요청에 기록해 둔다."""

    manual = "manual"  # 사용자 조작 (누르는 동안 녹화 등)
    auto_stillness = "auto_stillness"  # 움직임 정지 감지
    fixed = "fixed"  # 고정 길이


class CaptureMeta(BaseModel):
    """캡처 환경 메타데이터. 좌표 해석(종횡비)과 데이터셋 아카이브 분석에 필요하다.

    source_width/height: MediaPipe 정규화 좌표는 x를 너비로, y를 높이로 나누므로
    x·y를 섞는 거리 계산이 종횡비에 의존한다. 서버는 보정하지 않지만(학습과 동일)
    아카이브된 데이터의 특징값 이동을 추적하려면 해상도 기록이 필수다.
    """

    source_width: int = Field(gt=0)
    source_height: int = Field(gt=0)
    facing_mode: str = Field(description='카메라 방향 (예: "user", "environment")')
    preview_mirrored: bool = Field(description="프리뷰 CSS 미러링 여부 (handedness 해석에 필요)")
    delegate: str = Field(description='추론 백엔드 (예: "GPU", "CPU")')
    landmarker_model_versions: dict[str, str] = Field(
        default_factory=dict,
        description='landmarker 모델 버전 (예: {"hand": "...", "face": "..."})',
    )
    client_version: str = Field(description="앱 버전")


class SignSegment(BaseModel):
    """수어 동작 하나(단어 하나)에 해당하는 프레임 구간."""

    frames: list[LandmarkFrame]
    press_start_ms: float = Field(description="세그먼트 시작 시각 (ms, t_ms 와 같은 시계)")
    press_end_ms: float = Field(description="세그먼트 종료 시각 (ms)")
    boundary_mode: BoundaryMode
    capture: CaptureMeta

    @model_validator(mode="after")
    def _check_frames(self) -> "SignSegment":
        # 프레임 수 범위 — 서버 설정과 대조 (min/max 는 미확정 임시값, /model 로 노출)
        n = len(self.frames)
        if n < settings.min_frames:
            raise ValueError(f"segment must have at least {settings.min_frames} frames, got {n}")
        if n > settings.max_frames:
            raise ValueError(f"segment must have at most {settings.max_frames} frames, got {n}")
        # t_ms 단조증가
        for prev, cur in zip(self.frames, self.frames[1:]):
            if cur.t_ms <= prev.t_ms:
                raise ValueError(
                    f"frame t_ms must be strictly increasing ({prev.t_ms} -> {cur.t_ms})"
                )
        return self


class RecognizeRequest(BaseModel):
    session_id: str = Field(min_length=1, description="세션 식별자 (아카이브 그룹핑용)")
    request_id: str = Field(min_length=1, description="요청 식별자 (멱등·추적용)")
    segment: SignSegment


class RecognitionStatus(str, Enum):
    recognized = "recognized"
    rejected = "rejected"  # 추론은 했으나 최고 confidence 가 임계 미달
    low_quality = "low_quality"  # 입력 품질 문제로 추론 불가/무의미


class QualityIssue(str, Enum):
    """입력 품질 이슈.

    차단(blocking) — 추론을 건너뛰고 low_quality + 빈 candidates 로 응답:
      no_hand_detected, too_few_valid_frames
    어드바이저리(advisory) — 추론은 정상 진행하고 recognized/rejected 결과에
    참고용으로 첨부. 클라이언트는 안내 문구로만 쓴다:
      shoulders_not_visible, hand_partially_out
    """

    no_hand_detected = "no_hand_detected"  # 차단: 손이 잡힌 프레임 0개
    hand_out_of_frame = "hand_out_of_frame"
    shoulders_not_visible = "shoulders_not_visible"  # 어드바이저리: 전 구간 어깨 미검출
    too_few_valid_frames = "too_few_valid_frames"  # 차단: 손 프레임 < 최소 트리밍 길이
    hand_partially_out = "hand_partially_out"  # 어드바이저리: 트리밍 후 구간 내 손 프레임 비율 낮음


class SignCandidate(BaseModel):
    id: str = Field(description='어휘 ID, 예: "w_1510"')
    label: str = Field(description='화면 표시용 단어, 예: "꿈"')
    confidence: float = Field(ge=0, le=1)


class PreprocessInfo(BaseModel):
    """서버 전처리가 실제로 사용한 구간 정보 (디버깅·NFR 실측 근거)."""

    used_start_ms: float = Field(description="트리밍 후 사용한 첫 프레임의 t_ms")
    used_end_ms: float = Field(description="트리밍 후 사용한 마지막 프레임의 t_ms")
    used_frame_count: int = Field(description="트리밍 후 프레임 수 (리샘플 전)")
    interpolated_frame_count: int = Field(description="결측 보간이 개입한 프레임 수")
    preprocess_version: str


class RecognitionResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    request_id: str
    status: RecognitionStatus
    candidates: list[SignCandidate] = Field(
        description="confidence 내림차순 top-k. rejected/low_quality 면 빈 배열"
    )
    quality_issues: list[QualityIssue] = Field(
        default_factory=list,
        description=(
            "입력 품질 이슈. low_quality 일 때는 차단 사유, "
            "recognized/rejected 일 때도 어드바이저리 이슈가 담길 수 있다 (정상 경로)"
        ),
    )
    preprocess: PreprocessInfo | None = Field(
        default=None, description="전처리 정보. low_quality 로 추론을 건너뛰면 null"
    )
    model_version: str
    vocab_version: str
