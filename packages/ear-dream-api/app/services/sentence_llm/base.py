"""문장 생성기 인터페이스.

`Ear-Dream-Gloss2Sentence` 레포 `app/sentence_generation/base.py` 의 이식본이다.
구현을 갈아끼울 수 있게 추상으로 둔 이유는 원본과 같다 — vLLM 대신 다른 백엔드를
붙이거나, 테스트에서 가짜 생성기를 주입하기 위해서다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.schemas.sentence import SentenceEmotion, SentenceStyle


@dataclass(frozen=True)
class GenerationResult:
    text: str
    emotion: SentenceEmotion
    style: SentenceStyle
    # 실제로 호출한 모델 ID. 백엔드가 기계마다 갈리므로(vLLM/Ollama) 무엇이 이 문장을
    # 만들었는지 응답·로그에 남긴다 — 설정으로 연 모델 ID 가 조용히 갈리지 않게 하는 장치.
    model: str
    latency_ms: float
    timings_ms: dict[str, float] = field(default_factory=dict)


class SentenceGenerator(ABC):
    @abstractmethod
    async def generate(self, glosses: list[str]) -> GenerationResult:
        """Gloss(어휘 라벨) 열 하나를 한국어 문장 하나로 바꾼다."""
