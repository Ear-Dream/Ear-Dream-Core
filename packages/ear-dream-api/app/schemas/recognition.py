from pydantic import BaseModel, Field

# 손 랜드마크 1프레임 = 21점 x [x, y, z] (0~1 정규화)
HandFrame = list[list[float]]
LandmarkWindow = list[HandFrame]


class RecognizeRequest(BaseModel):
    window: LandmarkWindow = Field(description="최근 N프레임의 손 랜드마크 시퀀스")


class SignCandidate(BaseModel):
    id: str = Field(description='어휘 ID, 예: "w_hello"')
    label: str = Field(description='화면 표시용 단어, 예: "안녕하세요"')
    confidence: float = Field(ge=0, le=1)


class RecognitionResult(BaseModel):
    candidates: list[SignCandidate]
    window_ms: int = Field(description="추론에 사용한 시간창(ms)")
