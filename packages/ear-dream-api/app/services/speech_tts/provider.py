"""vLLM-Omni 연동 — 문장 + 감정·말투 → WAV.

`Ear-Dream-TTS` 레포 `app/tts/provider.py` 의 이식본이다. 요청 페이로드, WAV 검증,
instruction 실패 시 텍스트 전용 재시도(text_only_fallback)는 원본 그대로다.

**한 곳이 다르다: 파일이 아니라 bytes 를 돌려준다.** 원본은 WAV 를 `OUTPUT_DIR` 에
UUID 이름으로 저장하고 경로를 응답했다. 그건 원본이 독립 서비스라 가능한 계약이고,
여기서는 앱이 그 소리를 **재생**해야 한다 — 서버 파일 경로는 클라이언트에게 의미가
없다. 라우트가 bytes 를 그대로 `audio/wav` 로 흘려보내므로 정적 파일 서빙도, 생성물
디렉토리 관리(용량·보존 기간)도 필요 없다.
"""

from __future__ import annotations

import wave
from io import BytesIO

import httpx

from app.services.speech_tts.instructions import build_tts_instruction
from app.services.speech_tts.profile import LANGUAGE, TASK_TYPE


class TTSProviderError(RuntimeError):
    """상위 TTS 서비스가 실패했거나 유효하지 않은 오디오를 반환했다."""


def validate_wav(data: bytes) -> None:
    """빈/손상 WAV 를 성공으로 넘기지 않는다 (원본 결정 — 무음이 조용히 나가면 안 된다)."""
    if not data:
        raise TTSProviderError("vLLM-Omni returned empty audio")
    try:
        with wave.open(BytesIO(data), "rb") as wav:
            if wav.getnchannels() < 1 or wav.getframerate() < 1 or wav.getnframes() < 1:
                raise TTSProviderError("vLLM-Omni returned an empty WAV")
            wav.readframes(1)
    except (wave.Error, EOFError) as exc:
        raise TTSProviderError("vLLM-Omni returned invalid WAV data") from exc


class SynthesisResult:
    __slots__ = ("audio", "fallback_used")

    def __init__(self, audio: bytes, fallback_used: bool) -> None:
        self.audio = audio
        # instruction 을 뺀 재시도로 얻은 소리인지 — 감정·말투가 반영되지 않았다는 뜻이다.
        self.fallback_used = fallback_used


class VLLMOmniTTSProvider:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        base_url: str,
        model: str,
        voice: str,
        text_only_fallback: bool,
    ) -> None:
        self._client = client
        self._url = f"{base_url.rstrip('/')}/v1/audio/speech"
        self._model = model
        self._voice = voice
        self._text_only_fallback = text_only_fallback

    async def _request(self, payload: dict[str, object]) -> httpx.Response:
        try:
            response = await self._client.post(self._url, json=payload)
            response.raise_for_status()
            return response
        except httpx.TimeoutException as exc:
            raise TTSProviderError("vLLM-Omni request timed out") from exc
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise TTSProviderError(
                f"vLLM-Omni returned HTTP {exc.response.status_code}: {detail}"
            ) from exc
        except httpx.RequestError as exc:
            raise TTSProviderError(f"could not connect to vLLM-Omni: {exc}") from exc

    async def synthesize(self, text: str, emotion: str, style: str) -> SynthesisResult:
        voice_design = "VoiceDesign" in self._model
        payload: dict[str, object] = {
            "input": text,
            "model": self._model,
            "response_format": "wav",
            "task_type": TASK_TYPE if voice_design else "CustomVoice",
            "language": LANGUAGE,
            "instructions": build_tts_instruction(emotion, style),
        }
        if not voice_design:
            payload["voice"] = self._voice

        try:
            response = await self._request(payload)
            validate_wav(response.content)
            return SynthesisResult(response.content, fallback_used=False)
        except TTSProviderError:
            if not self._text_only_fallback:
                raise
            # instruction 이 문제였을 수 있으니 텍스트만으로 한 번 더 — 감정은 빠지지만
            # 소리는 나온다. 이 경로로 왔다는 사실은 응답 헤더·로그에 남긴다.
            fallback_payload = dict(payload)
            fallback_payload.pop("instructions", None)
            response = await self._request(fallback_payload)
            validate_wav(response.content)
            return SynthesisResult(response.content, fallback_used=True)
