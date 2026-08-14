"""/speech — 문장 + 감정·말투 → WAV 음성.

`Ear-Dream-TTS` 이식본(app/services/speech_tts)을 태운다. `/compose-sentence` 가 낸
문장과 태그를 그대로 넘기면 그 감정으로 읽는다.

**응답은 오디오 바이트다.** 원본은 서버에 WAV 를 저장하고 경로를 응답했지만, 여기서는
앱이 그 소리를 재생해야 하므로 `audio/wav` 로 흘려보낸다 (provider 모듈 주석 참조).

**꺼져 있거나 실패하면 503 이다.** 서버에는 대체 음성을 만들 수단이 없어서 폴백이
클라이언트 몫이다 — 앱이 브라우저 음성 합성으로 내려간다. 문장 변환(서버 안에서 규칙으로
폴백)과 다른 점이니, 503 을 "고장"이 아니라 **"이 서버로는 못 읽는다"** 는 신호로 다룬다.
"""

import time
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from app.core.logging import get_logger
from app.schemas.speech import SpeechRequest
from app.services.speech_tts import (
    TTS_INSTRUCTION_VERSION,
    TTSProviderError,
    VLLMOmniTTSProvider,
    get_tts_provider,
)

logger = get_logger("speech")

router = APIRouter(tags=["speech"])

_SPEECH_EXAMPLES = {
    "with_tags": {
        "summary": "감정·말투 태그 포함 — /compose-sentence 응답을 그대로 전달",
        "value": {"text": "병원에 가고 싶어요.", "emotion": "neutral", "style": "polite"},
    },
    "text_only": {
        "summary": "태그 없음 — 규칙 경로 문장(neutral/normal 로 읽는다)",
        "value": {"text": "밥을 부탁해요"},
    },
}


@router.post(
    "/speech",
    responses={
        200: {"content": {"audio/wav": {}}, "description": "24kHz mono 16-bit WAV"},
        503: {"description": "TTS 서버 없음 — 클라이언트가 자체 음성 합성으로 폴백한다"},
    },
    response_class=Response,
)
async def synthesize_speech(
    request: Annotated[SpeechRequest, Body(openapi_examples=_SPEECH_EXAMPLES)],
    provider: Annotated[VLLMOmniTTSProvider | None, Depends(get_tts_provider)],
) -> Response:
    if provider is None:
        logger.info('speech 503 disabled text="%s"', request.text)
        raise HTTPException(status_code=503, detail="TTS is disabled on this server")

    started = time.perf_counter()
    try:
        result = await provider.synthesize(request.text, request.emotion.value, request.style.value)
    except TTSProviderError as exc:
        logger.warning(
            'speech 503 tts_failed=%s text="%s" — 클라이언트 폴백: %s',
            type(exc).__name__,
            request.text,
            exc,
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    latency_ms = (time.perf_counter() - started) * 1000.0
    logger.info(
        'speech ok text="%s" emotion=%s style=%s bytes=%d fallback=%s latency_ms=%.1f',
        request.text,
        request.emotion.value,
        request.style.value,
        len(result.audio),
        result.fallback_used,
        latency_ms,
    )
    return Response(
        content=result.audio,
        media_type="audio/wav",
        headers={
            # instruction 없이 만든 소리인지 — 감정이 반영되지 않았다는 뜻이다.
            "X-TTS-Fallback": "1" if result.fallback_used else "0",
            "X-TTS-Instruction-Version": TTS_INSTRUCTION_VERSION,
        },
    )
