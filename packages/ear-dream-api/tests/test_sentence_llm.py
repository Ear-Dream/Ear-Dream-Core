"""문장 변환 LLM 경로 검증 — Ear-Dream-Gloss2Sentence 이식본.

원본 레포 `tests/test_sentence_generation.py` 를 이 레포 구조에 맞춰 옮긴 것이다.
vLLM 서버 없이 돈다: httpx MockTransport 로 응답을 흉내내거나, 라우트 검증은
`app.dependency_overrides` 로 가짜 생성기를 끼운다.

이 레포에만 있는 항목은 폴백 검증이다 — LLM 이 죽어도 `/compose-sentence` 는 200 이고
규칙 경로(template / word_list)로 답한다.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import app
from app.schemas.sentence import SentenceEmotion, SentenceStyle
from app.services.sentence_llm import (
    GenerationResult,
    LLMResponseError,
    SentenceGenerator,
    VLLMSentenceGenerator,
    get_sentence_generator,
)
from app.services.sentence_llm.vllm_client import GeneratedTags, _extract_json


class FakeGenerator(SentenceGenerator):
    async def generate(self, glosses: list[str]) -> GenerationResult:
        return GenerationResult(
            text="저는 내일 학교에 갑니다.",
            emotion=SentenceEmotion.neutral,
            style=SentenceStyle.formal,
            model="Qwen/Qwen3-4B",
            latency_ms=1.0,
            timings_ms={"llm": 0.5, "tagging": 0.4, "validation": 0.1},
        )


class FailingGenerator(SentenceGenerator):
    async def generate(self, glosses: list[str]) -> GenerationResult:
        raise httpx.ConnectError("vLLM 서버 없음")


def _mock_generator(handler) -> tuple[VLLMSentenceGenerator, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return VLLMSentenceGenerator(settings, client), client


def _body(word_ids: list[str]) -> dict:
    return {"session_id": "sess-1", "request_id": "req-s", "word_ids": word_ids}


# ---- LLM 출력 파싱


@pytest.mark.parametrize(
    "text",
    [
        '{"text":"문장"}',
        '```json\n{"text":"문장"}\n```',
        '<think>internal</think>{"text":"문장"}',
    ],
)
def test_extract_json_tolerates_common_wrappers(text: str) -> None:
    assert _extract_json(text)["text"] == "문장"


def test_extract_json_rejects_non_json() -> None:
    with pytest.raises(LLMResponseError):
        _extract_json("문장만 반환")


def test_tag_schema_rejects_unknown_labels() -> None:
    with pytest.raises(ValueError):
        GeneratedTags(emotion="excited", style="polite")  # type: ignore[arg-type]


# ---- 2단계 호출


def test_vllm_uses_two_qwen3_4b_requests() -> None:
    requests: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        content = (
            '{"text":"기쁘지 않아요."}'
            if len(requests) == 1
            else '{"emotion":"neutral","style":"polite"}'
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    generator, client = _mock_generator(handler)

    async def run() -> GenerationResult:
        try:
            return await generator.generate(["기쁘다", "아니다"])
        finally:
            await client.aclose()

    result = asyncio.run(run())

    assert len(requests) == 2
    assert all(item["model"] == settings.sentence_llm_model for item in requests)
    assert requests[1]["temperature"] == 0.0
    # 2단계는 원본 Gloss 와 1단계 문장을 함께 본다 (감정 판정의 근거).
    assert "기쁘지 않아요." in requests[1]["messages"][1]["content"]
    assert result.text == "기쁘지 않아요."
    assert result.emotion is SentenceEmotion.neutral
    assert result.style is SentenceStyle.polite
    assert result.timings_ms["llm"] >= 0
    assert result.timings_ms["tagging"] >= 0


def test_invalid_classifier_result_fails_closed() -> None:
    """허용 목록 밖 태그는 기본값으로 덮지 않고 실패로 다룬다 (원본 결정)."""
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        content = (
            '{"text":"학교에 가요."}' if calls == 1 else '{"emotion":"excited","style":"polite"}'
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    generator, client = _mock_generator(handler)

    async def run() -> None:
        try:
            await generator.generate(["학교", "가다"])
        finally:
            await client.aclose()

    with pytest.raises(LLMResponseError):
        asyncio.run(run())


def test_default_model_is_the_validated_one() -> None:
    """모델 ID 는 설정으로 열려 있지만(맥/윈도우 백엔드 분기) **기본값은 검증 모델**이다.

    원본 레포는 상수로 못 박아 환경변수 변경을 막았다. 여기서는 vLLM(CUDA 전용)이 맥에서
    안 돌아 Ollama 로 갈아탈 수 있어야 해서 열되, 기본값과 응답 기록으로 "조용히 갈리지
    않는다"는 원래 취지를 지킨다.
    """
    # 인스턴스가 아니라 **클래스 기본값**을 본다 — 맥에서 .env 로 Ollama 를 켜 둔 개발자의
    # 테스트가 깨지면 안 된다 (검증하려는 건 코드의 기본값이지 그 기계의 설정이 아니다).
    defaults = Settings.model_fields
    assert defaults["sentence_llm_model"].default == "Qwen/Qwen3-4B"
    # 백엔드 우회 스위치 2종도 기본은 꺼짐이어야 한다 — 켜진 채 병합되면 vLLM 프로필의
    # 페이로드가 원본 평가 조건에서 조용히 벗어난다.
    assert defaults["sentence_llm_reasoning_effort"].default is None
    assert defaults["sentence_llm_structured_output"].default is False


def test_model_id_follows_settings(monkeypatch) -> None:
    """맥(Ollama `qwen3:4b`) 분기 — 설정한 모델이 그대로 호출되고 결과에 실린다."""
    monkeypatch.setattr(settings, "sentence_llm_model", "qwen3:4b")
    seen: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body["model"])
        content = (
            '{"text":"밥을 부탁해요."}'
            if len(seen) == 1
            else '{"emotion":"neutral","style":"polite"}'
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    generator, client = _mock_generator(handler)

    async def run() -> GenerationResult:
        try:
            return await generator.generate(["밥", "부탁"])
        finally:
            await client.aclose()

    result = asyncio.run(run())
    assert seen == ["qwen3:4b", "qwen3:4b"]
    assert result.model == "qwen3:4b"


def test_reasoning_effort_is_opt_in(monkeypatch) -> None:
    """`reasoning_effort` 는 설정했을 때만 실린다.

    thinking 모델(qwen3 계열)을 Ollama 로 쓸 때만 필요한 필드다 — vLLM 프로필의
    페이로드를 건드리지 않아야 해서 기본값은 미전송이다 (config 주석 참조).
    """
    # 기계의 .env 가 아니라 **코드 동작**을 검증한다. 맥 개발자의 .env 는 이 값을
    # 켜 두므로 전역 settings 를 그대로 두면 "기본값" 단정이 그 기계에서만 깨진다.
    monkeypatch.setattr(settings, "sentence_llm_reasoning_effort", None)
    seen: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        content = (
            '{"text":"밥을 부탁해요."}'
            if len(seen) == 1
            else '{"emotion":"neutral","style":"polite"}'
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    def run_once() -> None:
        generator, client = _mock_generator(handler)

        async def run() -> None:
            try:
                await generator.generate(["밥", "부탁"])
            finally:
                await client.aclose()

        asyncio.run(run())

    run_once()
    assert all("reasoning_effort" not in payload for payload in seen)

    seen.clear()
    monkeypatch.setattr(settings, "sentence_llm_reasoning_effort", "none")
    run_once()
    assert [payload["reasoning_effort"] for payload in seen] == ["none", "none"]


def test_structured_output_is_opt_in(monkeypatch) -> None:
    """출력 형식 강제는 opt-in 이고, 켜면 각 단계의 출력 계약 스키마가 실린다.

    thinking 을 끈 qwen3:4b 는 이게 없으면 2단계에서 분류 대신 입력을 되돌려준다
    (config 주석). 기본값은 원본과 같은 json_object 다 — vLLM 프로필 불변.
    """
    monkeypatch.setattr(settings, "sentence_llm_structured_output", False)
    seen: list[dict] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        content = (
            '{"text":"밥을 부탁해요."}'
            if len(seen) == 1
            else '{"emotion":"neutral","style":"polite"}'
        )
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    def run_once() -> None:
        generator, client = _mock_generator(handler)

        async def run() -> None:
            try:
                await generator.generate(["밥", "부탁"])
            finally:
                await client.aclose()

        asyncio.run(run())

    run_once()
    assert [p["response_format"]["type"] for p in seen] == ["json_object", "json_object"]

    seen.clear()
    monkeypatch.setattr(settings, "sentence_llm_structured_output", True)
    run_once()
    assert [p["response_format"]["type"] for p in seen] == ["json_schema", "json_schema"]
    # 스키마는 프롬프트가 아니라 출력 계약 모델에서 파생된다 — 프롬프트는 손대지 않는다.
    sentence_schema = seen[0]["response_format"]["json_schema"]["schema"]
    tags_schema = seen[1]["response_format"]["json_schema"]["schema"]
    assert sentence_schema["required"] == ["text"]
    assert set(tags_schema["required"]) == {"emotion", "style"}
    assert tags_schema["$defs"]["SentenceStyle"]["enum"] == ["normal", "polite", "casual", "formal"]


def test_tag_stage_can_be_disabled(monkeypatch) -> None:
    """태그 분류를 끄면 추론이 1회로 줄고 태그는 기본값이다."""
    monkeypatch.setattr(settings, "sentence_llm_tags_enabled", False)
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"text":"학교에 가요."}'}}]}
        )

    generator, client = _mock_generator(handler)

    async def run() -> GenerationResult:
        try:
            return await generator.generate(["학교", "가다"])
        finally:
            await client.aclose()

    result = asyncio.run(run())
    assert calls == 1
    assert result.emotion is SentenceEmotion.neutral
    assert result.style is SentenceStyle.normal


# ---- /compose-sentence 연결


def test_compose_uses_llm_when_available(client: TestClient) -> None:
    app.dependency_overrides[get_sentence_generator] = lambda: FakeGenerator()
    try:
        res = client.post("/api/v1/compose-sentence", json=_body(["w_1534", "w_1589"]))
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    data = res.json()
    cand = data["candidates"][0]
    # 템플릿이 있는 조합이어도 LLM 이 살아 있으면 LLM 문장이 나간다.
    assert cand["source"] == "model"
    assert cand["text"] == "저는 내일 학교에 갑니다."
    assert cand["emotion"] == "neutral"
    assert cand["style"] == "formal"
    assert data["llm_model"] == "Qwen/Qwen3-4B"
    assert data["llm_prompt_version"]


def test_compose_falls_back_to_rules_when_llm_fails(client: TestClient) -> None:
    """vLLM 이 죽어도 200 — 규칙 템플릿으로 답한다."""
    app.dependency_overrides[get_sentence_generator] = lambda: FailingGenerator()
    try:
        res = client.post("/api/v1/compose-sentence", json=_body(["w_1534", "w_1589"]))
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    data = res.json()
    cand = data["candidates"][0]
    assert cand == {
        "text": "밥을 부탁해요",
        "word_ids": ["w_1534", "w_1589"],
        "source": "template",
        "emotion": None,
        "style": None,
    }
    assert data["llm_model"] is None


def test_compose_falls_back_to_word_list_when_llm_fails(client: TestClient) -> None:
    """템플릿도 없으면 문장을 지어내지 않고 라벨 나열로 내려간다."""
    app.dependency_overrides[get_sentence_generator] = lambda: FailingGenerator()
    try:
        res = client.post("/api/v1/compose-sentence", json=_body(["w_1157", "w_1534"]))  # 나 밥
    finally:
        app.dependency_overrides.clear()

    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "나 밥"
    assert cand["source"] == "word_list"


def test_unknown_word_id_422_before_llm(client: TestClient) -> None:
    """어휘 검증이 먼저다 — 모르는 ID 로 LLM 을 부르지 않는다."""

    class ExplodingGenerator(SentenceGenerator):
        async def generate(self, glosses: list[str]) -> GenerationResult:
            raise AssertionError("어휘 검증 전에 LLM 이 불렸다")

    app.dependency_overrides[get_sentence_generator] = lambda: ExplodingGenerator()
    try:
        res = client.post("/api/v1/compose-sentence", json=_body(["w_9999"]))
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 422


def test_generator_is_none_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "sentence_llm_enabled", False)
    assert get_sentence_generator() is None
