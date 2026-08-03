from pydantic import BaseModel


class PresetPhrase(BaseModel):
    id: str
    category: str  # 예: "의료", "교통", "일상"
    text: str  # 청인에게 전달될 문장
