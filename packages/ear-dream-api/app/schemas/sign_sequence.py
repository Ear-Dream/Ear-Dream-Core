"""/sign-sequence 요청·응답 스키마 — 청인 문장을 아바타가 재생할 단어 시퀀스로 바꾼다.

`/compose-sentence`(단어열 → 문장)의 역방향이자 `/recognize`(동작 → 단어)의 역방향이다.

**좌표는 응답에 없다.** 클라이언트가 시퀀스를 빌트인 자산으로 갖고 있고
(`packages/ear-dream-app/public/sign-sequences/`), 응답은 "무엇을 어떤 순서로 재생하라" 는
지시와 자산을 찾아갈 키만 싣는다. 단어당 좌표가 60 KiB 라 응답에 넣으면 문장 하나에
수백 KiB 가 매번 흐른다.
"""

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class SignSequenceRequest(BaseModel):
    session_id: str = Field(min_length=1)
    request_id: str = Field(min_length=1)
    text: str = Field(
        min_length=1,
        description='청인 발화 문장 (STT 결과). 예: "밥을 부탁해요"',
    )

    @field_validator("text")
    @classmethod
    def _reject_blank(cls, value: str) -> str:
        # min_length=1 은 공백만 있는 문자열을 통과시킨다. 분해할 내용이 없는 입력은
        # 빈 결과를 200 으로 돌려주는 것보다 422 가 정직하다 (클라이언트 버그를 덮지 않는다).
        if not value.strip():
            raise ValueError("text 가 공백뿐이다")
        return value


class SignSequenceSource(str, Enum):
    """단어열을 만든 경로. `/compose-sentence` 의 SentenceSource 와 대칭이다."""

    template = "template"  # 문장 전체가 규칙 템플릿 역인덱스에 적중
    word_list = "word_list"  # 공백 분해 후 어휘 라벨 대조 (template 미적중 시)
    model = "model"  # 문장→단어열 변환 모델. **아직 없다** — 도입 시 이 값이 쓰인다


class SignSequenceIssue(str, Enum):
    """단어를 재생할 수 없는 이유. 이 둘을 구분하는 것이 이 API 의 핵심이다.

    섞어 놓으면 나중에 진짜 변환 모델을 붙였을 때 "변환은 됐는데 재생할 게 없는" 상태와
    "변환 자체가 안 된" 상태를 구분할 수 없다 — 전자는 시퀀스 데이터를 더 뽑으면 풀리고
    후자는 어휘·변환 모델의 문제라 대응이 완전히 다르다.
    """

    unknown_word = "unknown_word"  # 어휘 300에 없다 → 변환 불가
    no_sequence = "no_sequence"  # 어휘엔 있으나 아바타 시퀀스 자산이 없다


class SignSequenceItem(BaseModel):
    source_text: str = Field(
        description=(
            "이 항목을 만든 입력 조각. word_list 경로에서는 입력 토큰 그대로이고, "
            "template 경로에서는 문장 전체가 한 덩어리로 적중하므로 어휘 라벨이 들어간다."
        )
    )
    word_id: str | None = Field(
        default=None, description='어휘 ID. unknown_word 이면 null (예: "w_1534")'
    )
    label: str | None = Field(default=None, description="어휘 대표 표기. unknown_word 이면 null")
    sequence_key: str | None = Field(
        default=None,
        description=(
            "빌트인 시퀀스 자산 조회 키. 재생 불가(issue != null)이면 null. "
            "클라이언트는 word_id 로 파일명을 조립하지 말고 이 키를 쓴다 "
            "— 조음 변형이 생기면 키만 갈라진다."
        ),
    )
    frame_count: int | None = Field(
        default=None, description="재생 프레임 수. 재생 불가이면 null (원본 fps 는 응답 최상위)"
    )
    issue: SignSequenceIssue | None = Field(
        default=None, description="재생 불가 사유. null 이면 재생 가능하다"
    )


class SignSequenceResult(BaseModel):
    request_id: str
    text: str = Field(description="입력 문장 그대로 (클라이언트 대조용)")
    source: SignSequenceSource
    items: list[SignSequenceItem] = Field(
        description="입력 순서 그대로. 재생 불가 항목도 **빼지 않고** issue 를 달아 싣는다 "
        "— 어느 단어에서 막혔는지가 이 응답의 핵심 정보다."
    )
    playable: bool = Field(
        description="전 항목이 재생 가능하면 true. 하나라도 issue 가 있으면 false"
    )
    asset_path: str = Field(
        description='빌트인 자산 디렉토리명 (앱 public/ 기준). 예: "sign-sequences"'
    )
    source_fps: float = Field(
        description="시퀀스 원본 영상 fps — 클라이언트 재생 속도 기준. "
        "⚠️ 전처리 계약 문서 인용값이지 실측값이 아니다"
    )
    sequence_bundle_version: str = Field(
        description="시퀀스 번들 판본. 클라이언트 index.json 의 bundle_version 과 다르면 "
        "서버 매니페스트와 빌트인 자산이 어긋난 것이다"
    )
    ruleset_version: str = Field(description="문장 분해 규칙 판본 (모델 도입 전 임시 경로)")
