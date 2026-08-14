"""문장 → 음성 (Qwen3-TTS VoiceDesign / vLLM-Omni).

`Ear-Dream-TTS` 레포에서 이식했다. 원본은 독립 FastAPI(`POST /v1/tts`)가 vLLM-Omni
앞에 서고 그 위에 `/v1/gloss-to-speech` 가 문장 모듈을 호출하는 3단 구성이었다.
여기서는 그 중간 FastAPI 를 흡수해 **Core 가 vLLM-Omni(:8091)에 직접 붙고**,
`/v1/gloss-to-speech` 가 하던 "문장 만들고 → 읽기"는 이미 있는 두 엔드포인트
(`/compose-sentence` → `/speech`)의 조합으로 대체한다. 문장 LLM 이식 때와 같은 방침이다.

**vLLM-Omni 는 CUDA 전용이라 맥에서 안 돈다.** 없으면 라우트가 503 을 내고 앱은 브라우저
음성 합성(SpeechSynthesis)으로 내려간다 — 소리는 계속 나온다. 문장 LLM 의 규칙 폴백과
같은 취지이되, 폴백 위치가 서버가 아니라 클라이언트라는 점이 다르다: 대체 음성을 만들
수단이 서버에는 없고 브라우저에는 있기 때문이다.
"""

from __future__ import annotations

import httpx

from app.core.config import settings
from app.services.speech_tts.profile import MODEL, TTS_INSTRUCTION_VERSION
from app.services.speech_tts.provider import (
    SynthesisResult,
    TTSProviderError,
    VLLMOmniTTSProvider,
    validate_wav,
)

__all__ = [
    "MODEL",
    "TTS_INSTRUCTION_VERSION",
    "SynthesisResult",
    "TTSProviderError",
    "VLLMOmniTTSProvider",
    "aclose_tts_provider",
    "get_tts_provider",
    "validate_wav",
]

_client: httpx.AsyncClient | None = None
_provider: VLLMOmniTTSProvider | None = None


def get_tts_provider() -> VLLMOmniTTSProvider | None:
    """TTS 공급자. 꺼져 있으면 None — 라우트가 503 을 내고 앱이 폴백한다.

    FastAPI 의존성으로 쓰므로 테스트는 `app.dependency_overrides` 로 갈아끼운다.
    """
    global _client, _provider
    if not settings.tts_enabled:
        return None
    if _provider is None:
        _client = httpx.AsyncClient(timeout=settings.tts_timeout_seconds)
        _provider = VLLMOmniTTSProvider(
            client=_client,
            base_url=settings.tts_base_url,
            model=settings.tts_model,
            voice=settings.tts_voice,
            text_only_fallback=settings.tts_text_only_fallback,
        )
    return _provider


async def aclose_tts_provider() -> None:
    global _client, _provider
    if _client is not None:
        await _client.aclose()
    _client = None
    _provider = None
