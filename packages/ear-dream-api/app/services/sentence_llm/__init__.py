"""단어열 → 문장 변환 LLM (Qwen3-4B / vLLM).

`Ear-Dream-Gloss2Sentence` 레포에서 이식했다. 원본은 독립 FastAPI 서비스(`POST /v1/sentence`)
였고, 여기서는 `/compose-sentence` 뒤에 붙는 **한 단계**로 들어간다 — 라우트가 어휘 ID 를
라벨(gloss)로 바꿔 넘기고, 실패하면 기존 규칙 경로로 폴백한다 (app/api/v1/sentence.py).

LLM 서버는 **이 레포 밖**에서 돈다. 기계에 따라 백엔드가 갈리고(Windows/WSL = vLLM,
macOS = Ollama — README 「단어열 → 문장 변환」), 갈리는 건 `sentence_llm_base_url` 과
`sentence_llm_model` 두 설정뿐이다. 둘 다 OpenAI 호환 `/chat/completions` 라서다.
서버가 없거나 죽어 있어도 `/compose-sentence` 는 200 을 유지한다 — 폴백이 그 역할이다.

생성기는 프로세스당 하나이고 httpx AsyncClient 를 공유한다. 클라이언트는 첫 요청 때
(이벤트 루프 안에서) 만들고 앱 종료 시 닫는다 (app/main.py lifespan).
"""

from __future__ import annotations

import httpx

from app.core.config import settings
from app.services.sentence_llm.base import GenerationResult, SentenceGenerator
from app.services.sentence_llm.prompt import SENTENCE_LLM_PROMPT_VERSION
from app.services.sentence_llm.vllm_client import LLMResponseError, VLLMSentenceGenerator

__all__ = [
    "SENTENCE_LLM_PROMPT_VERSION",
    "GenerationResult",
    "LLMResponseError",
    "SentenceGenerator",
    "VLLMSentenceGenerator",
    "aclose_sentence_generator",
    "get_sentence_generator",
]

_client: httpx.AsyncClient | None = None
_generator: SentenceGenerator | None = None


def get_sentence_generator() -> SentenceGenerator | None:
    """문장 생성기. LLM 을 끈 설정이면 None — 호출부는 규칙 경로로 간다.

    FastAPI 의존성으로 쓰므로 테스트는 `app.dependency_overrides` 로 갈아끼운다.
    """
    global _client, _generator
    if not settings.sentence_llm_enabled:
        return None
    if _generator is None:
        _client = httpx.AsyncClient(timeout=settings.sentence_llm_timeout_seconds)
        _generator = VLLMSentenceGenerator(settings, _client)
    return _generator


async def aclose_sentence_generator() -> None:
    global _client, _generator
    if _client is not None:
        await _client.aclose()
    _client = None
    _generator = None
