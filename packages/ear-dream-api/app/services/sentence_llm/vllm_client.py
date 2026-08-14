"""2단계 OpenAI-compatible 문장 생성 클라이언트.

`Ear-Dream-Gloss2Sentence` 레포 `app/sentence_generation/vllm_client.py` 의 이식본이다.
호출 구조(문장 생성 → 태그 분류, 각각 별도 요청)와 JSON 추출 관용 처리는 원본 그대로다.

**vLLM 전용이 아니다.** OpenAI 호환 `/chat/completions` 를 내는 백엔드면 같은 코드로
붙는다 — Windows/WSL 은 vLLM, macOS 는 Ollama 다 (CUDA 전용인 vLLM 이 맥에서 안 돈다).
클래스 이름은 이식 출처를 알아볼 수 있게 원본 그대로 뒀다.

모델 ID 는 그 분기 때문에 설정으로 열려 있다 (`sentence_llm_model`). 기본값은 원본이
검증한 `Qwen/Qwen3-4B` 이고, **실제 호출한 모델은 GenerationResult.model 로 돌려준다** —
프롬프트·평가 수치는 그 모델 위에서 나온 값이라 무엇을 썼는지가 응답에 남아야 한다.
"""

from __future__ import annotations

import json
import re
from time import perf_counter
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import Settings
from app.schemas.sentence import SentenceEmotion, SentenceStyle
from app.services.sentence_llm.base import GenerationResult, SentenceGenerator
from app.services.sentence_llm.prompt import (
    SYSTEM_PROMPT,
    TAG_SYSTEM_PROMPT,
    build_tag_prompt,
    build_user_prompt,
)

# 태그 분류 호출 설정 — 원본 고정값 (분류는 짧고 결정적이어야 한다).
_TAG_TEMPERATURE = 0.0
_TAG_MAX_TOKENS = 64


class LLMResponseError(RuntimeError):
    """모델 응답이 출력 계약을 만족하지 못했을 때."""


class GeneratedSentence(BaseModel):
    """1단계 LLM 출력 계약 — 문장 생성.

    API 응답 스키마가 아니라 **LLM 출력 검증용**이다. 라우트가 참조하지 않으므로
    생성 TS 에도 나타나지 않는다 (CLAUDE.md 「API 계약 규칙」).
    """

    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1)


class GeneratedTags(BaseModel):
    """2단계 LLM 출력 계약 — 감정·말투 분류."""

    model_config = ConfigDict(extra="forbid")
    emotion: SentenceEmotion
    style: SentenceStyle


def _extract_json(text: str) -> dict[str, Any]:
    """모델이 JSON 을 감싸 내보내는 흔한 형태(think 태그·코드펜스·서론)를 벗겨낸다."""
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            raise LLMResponseError("LLM did not return a JSON object") from None
        try:
            value = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise LLMResponseError("LLM returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise LLMResponseError("LLM JSON response must be an object")
    return value


class VLLMSentenceGenerator(SentenceGenerator):
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._client = client

    def _response_format(self, schema: type[BaseModel], name: str) -> dict[str, Any]:
        """출력 형식 지시. 기본은 원본과 같은 json_object, 켜면 스키마 강제.

        스키마는 출력 계약 모델에서 파생한다 — 프롬프트를 고치지 않고 형식만 조인다.
        """
        if not self.settings.sentence_llm_structured_output:
            return {"type": "json_object"}
        return {
            "type": "json_schema",
            "json_schema": {"name": name, "schema": schema.model_json_schema(), "strict": True},
        }

    def _payload(
        self,
        system: str,
        user: str,
        *,
        temperature: float,
        max_tokens: int,
        schema: type[BaseModel],
        schema_name: str,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.settings.sentence_llm_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": self._response_format(schema, schema_name),
            # vLLM 이 thinking 을 끄는 방법. Ollama 는 이 필드를 조용히 무시하므로
            # 그쪽은 아래 reasoning_effort 로 끈다 (config 주석 참조).
            "chat_template_kwargs": {"enable_thinking": False},
        }
        # 설정된 경우에만 싣는다 — vLLM 프로필의 페이로드를 바꾸지 않기 위해서다.
        if self.settings.sentence_llm_reasoning_effort:
            payload["reasoning_effort"] = self.settings.sentence_llm_reasoning_effort
        return payload

    async def _complete(self, client: httpx.AsyncClient, payload: dict[str, Any]) -> dict[str, Any]:
        response = await client.post(
            f"{self.settings.sentence_llm_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.settings.sentence_llm_api_key}"},
            json=payload,
        )
        response.raise_for_status()
        try:
            content = response.json()["choices"][0]["message"]["content"]
            return _extract_json(content)
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMResponseError("LLM response does not contain valid JSON content") from exc

    async def generate(self, glosses: list[str]) -> GenerationResult:
        started = perf_counter()
        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=self.settings.sentence_llm_timeout_seconds
        )
        try:
            sentence_started = perf_counter()
            sentence_data = await self._complete(
                client,
                self._payload(
                    SYSTEM_PROMPT,
                    build_user_prompt(glosses),
                    temperature=self.settings.sentence_llm_temperature,
                    max_tokens=self.settings.sentence_llm_max_tokens,
                    schema=GeneratedSentence,
                    schema_name="generated_sentence",
                ),
            )
            generated = GeneratedSentence.model_validate(sentence_data)
            sentence_ms = (perf_counter() - sentence_started) * 1000

            # 2단계 태그 분류. 끄면 요청당 추론이 절반이 되는 대신 감정·말투가 기본값이다.
            tagging_started = perf_counter()
            if self.settings.sentence_llm_tags_enabled:
                tag_data = await self._complete(
                    client,
                    self._payload(
                        TAG_SYSTEM_PROMPT,
                        build_tag_prompt(glosses, generated.text),
                        temperature=_TAG_TEMPERATURE,
                        max_tokens=_TAG_MAX_TOKENS,
                        schema=GeneratedTags,
                        schema_name="generated_tags",
                    ),
                )
                tags = GeneratedTags.model_validate(tag_data)
            else:
                tags = GeneratedTags(emotion=SentenceEmotion.neutral, style=SentenceStyle.normal)
            tagging_ms = (perf_counter() - tagging_started) * 1000
        except ValidationError as exc:
            # 허용 목록 밖의 태그나 스키마 위반은 기본값으로 덮지 않고 실패로 다룬다
            # (원본 레포 결정 — 조용히 neutral 로 뭉개면 분류 회귀를 못 잡는다).
            raise LLMResponseError("LLM response does not match the required schema") from exc
        finally:
            if owns_client:
                await client.aclose()

        total_ms = (perf_counter() - started) * 1000
        return GenerationResult(
            text=generated.text,
            emotion=tags.emotion,
            style=tags.style,
            model=self.settings.sentence_llm_model,
            latency_ms=total_ms,
            timings_ms={
                "llm": sentence_ms,
                "tagging": tagging_ms,
                "validation": max(0.0, total_ms - sentence_ms - tagging_ms),
            },
        )
