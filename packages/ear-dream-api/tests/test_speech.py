"""/speech 검증 — Ear-Dream-TTS 이식본.

vLLM-Omni 없이 돈다: httpx MockTransport 로 WAV 를 흉내내거나 dependency_overrides 로
가짜 공급자를 끼운다. 이 레포에만 있는 항목은 **503 계약**이다 — 서버에는 대체 음성
수단이 없어 폴백이 클라이언트 몫이라, 503 이 앱의 브라우저 음성 합성 경로를 여는 신호다.
"""

from __future__ import annotations

import asyncio
import io
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import app
from app.services.speech_tts import (
    MODEL,
    TTSProviderError,
    VLLMOmniTTSProvider,
    get_tts_provider,
    validate_wav,
)
from app.services.speech_tts.instructions import build_tts_instruction
from app.services.speech_tts.profile import LANGUAGE, TASK_TYPE


def make_wav(seconds: float = 0.05, rate: int = 24000) -> bytes:
    """24kHz mono 16-bit — 원본이 내는 형식."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * int(rate * seconds))
    return buffer.getvalue()


def _provider(
    handler, *, text_only_fallback: bool = True
) -> tuple[VLLMOmniTTSProvider, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return (
        VLLMOmniTTSProvider(
            client=client,
            base_url="http://tts.test",
            model=MODEL,
            voice="sohee",
            text_only_fallback=text_only_fallback,
        ),
        client,
    )


def _run(provider: VLLMOmniTTSProvider, client: httpx.AsyncClient, *args):
    async def run():
        try:
            return await provider.synthesize(*args)
        finally:
            await client.aclose()

    return asyncio.run(run())


# ---- 프로필·instruction


def test_config_default_matches_profile_model() -> None:
    """설정 기본값과 프로필 상수가 갈리면 안 된다 (순환 import 때문에 리터럴로 둔 값)."""
    assert Settings.model_fields["tts_model"].default == MODEL


def test_instruction_combines_emotion_and_style() -> None:
    text = build_tts_instruction("happy", "polite")
    assert "기쁜 소식을 전하듯" in text
    assert "정중하고 예의 바른" in text


def test_instruction_rejects_unknown_labels() -> None:
    with pytest.raises(ValueError):
        build_tts_instruction("excited", "polite")  # excited 는 emotion 이 아니라 style 이다


def test_sentence_styles_are_covered_by_tts_instructions() -> None:
    """문장 LLM 이 내는 말투 4종은 전부 instruction 표에 있어야 한다 — 없으면 재생이 깨진다."""
    from app.schemas.sentence import SentenceEmotion, SentenceStyle

    for emotion in SentenceEmotion:
        for style in SentenceStyle:
            assert build_tts_instruction(emotion.value, style.value)


# ---- WAV 검증


def test_validate_wav_rejects_empty_and_garbage() -> None:
    with pytest.raises(TTSProviderError):
        validate_wav(b"")
    with pytest.raises(TTSProviderError):
        validate_wav(b"not a wav")


def test_validate_wav_accepts_real_wav() -> None:
    validate_wav(make_wav())


# ---- 공급자


def test_synthesize_sends_voicedesign_payload() -> None:
    seen: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        import json

        seen.append(json.loads(request.content))
        return httpx.Response(200, content=make_wav())

    provider, client = _provider(handler)
    result = _run(provider, client, "밥을 부탁해요.", "neutral", "polite")

    assert result.fallback_used is False
    assert len(seen) == 1
    payload = seen[0]
    assert payload["model"] == MODEL
    assert payload["task_type"] == TASK_TYPE
    assert payload["language"] == LANGUAGE
    assert payload["response_format"] == "wav"
    assert "정중하고" in payload["instructions"]
    # VoiceDesign 은 preset voice 를 쓰지 않는다 (원본 결정)
    assert "voice" not in payload


def test_text_only_fallback_retries_without_instructions() -> None:
    calls: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        import json

        payload = json.loads(request.content)
        calls.append(payload)
        if "instructions" in payload:
            return httpx.Response(500, text="instruction rejected")
        return httpx.Response(200, content=make_wav())

    provider, client = _provider(handler)
    result = _run(provider, client, "밥을 부탁해요.", "happy", "casual")

    assert len(calls) == 2
    assert "instructions" not in calls[1]
    # 감정이 빠진 소리라는 사실이 드러나야 한다
    assert result.fallback_used is True


def test_fallback_can_be_disabled() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="nope")

    provider, client = _provider(handler, text_only_fallback=False)
    with pytest.raises(TTSProviderError):
        _run(provider, client, "밥", "neutral", "normal")


def test_empty_audio_is_not_success() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"")

    # 폴백도 빈 응답이면 최종 실패여야 한다 — 무음이 조용히 나가면 안 된다
    provider, client = _provider(handler)
    with pytest.raises(TTSProviderError):
        _run(provider, client, "밥", "neutral", "normal")


# ---- 라우트


class FakeProvider:
    def __init__(self, audio: bytes | None = None, error: Exception | None = None) -> None:
        self._audio = audio
        self._error = error
        self.seen: list[tuple[str, str, str]] = []

    async def synthesize(self, text: str, emotion: str, style: str):
        self.seen.append((text, emotion, style))
        if self._error:
            raise self._error
        from app.services.speech_tts import SynthesisResult

        return SynthesisResult(self._audio or make_wav(), fallback_used=False)


def test_speech_returns_wav(client: TestClient) -> None:
    fake = FakeProvider()
    app.dependency_overrides[get_tts_provider] = lambda: fake
    try:
        res = client.post(
            "/api/v1/speech",
            json={"text": "병원에 가고 싶어요.", "emotion": "neutral", "style": "polite"},
        )
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.headers["x-tts-fallback"] == "0"
    validate_wav(res.content)
    assert fake.seen == [("병원에 가고 싶어요.", "neutral", "polite")]


def test_speech_defaults_tags_when_omitted(client: TestClient) -> None:
    """규칙 경로 문장은 태그가 없다 — 기본값으로 읽는다."""
    fake = FakeProvider()
    app.dependency_overrides[get_tts_provider] = lambda: fake
    try:
        res = client.post("/api/v1/speech", json={"text": "밥을 부탁해요"})
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert fake.seen == [("밥을 부탁해요", "neutral", "normal")]


def test_speech_503_when_disabled(client: TestClient) -> None:
    """꺼져 있으면 503 — 앱이 브라우저 음성 합성으로 폴백하는 신호다."""
    app.dependency_overrides[get_tts_provider] = lambda: None
    try:
        res = client.post("/api/v1/speech", json={"text": "밥"})
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503


def test_speech_503_when_tts_fails(client: TestClient) -> None:
    app.dependency_overrides[get_tts_provider] = lambda: FakeProvider(
        error=TTSProviderError("could not connect to vLLM-Omni")
    )
    try:
        res = client.post("/api/v1/speech", json={"text": "밥"})
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 503


def test_speech_422_on_blank_text(client: TestClient) -> None:
    res = client.post("/api/v1/speech", json={"text": "   "})
    assert res.status_code == 422


def test_provider_is_none_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "tts_enabled", False)
    assert get_tts_provider() is None
