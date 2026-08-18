"""요청 본문 크기 상한 (app/core/limits.py · app/core/compression.py).

공개 URL(터널)로 열면 인증 없는 /recognize 가 그대로 노출되고, 라우트는 Pydantic 검증
**이전**에 raw body 를 버퍼링해 디스크에 아카이빙한다. 상한이 없으면 요청 하나로
메모리와 디스크가 함께 나간다.
"""

from __future__ import annotations

import gzip

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.limits import BodySizeLimitMiddleware


def _app_with_limit(max_bytes: int) -> TestClient:
    """상한만 바꾼 최소 앱. 실제 앱은 설정값으로 상한을 고정해 등록하므로 여기서 격리한다."""
    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=max_bytes)

    @app.post("/echo")
    async def echo(payload: dict) -> dict:
        return payload

    return TestClient(app)


def test_oversized_body_is_413_before_reading() -> None:
    """상한을 넘는 Content-Length 는 본문을 읽기 전에 끊는다."""
    client = _app_with_limit(1024)
    res = client.post("/echo", content=b"x" * 4096, headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert "too large" in res.json()["detail"]


def test_body_within_limit_passes() -> None:
    """상한 아래는 그대로 통과한다 — 방어가 정상 경로를 막으면 안 된다."""
    client = _app_with_limit(1024)
    res = client.post("/echo", json={"a": 1})
    assert res.status_code == 200
    assert res.json() == {"a": 1}


def test_gzip_bomb_is_413_not_oom(client: TestClient) -> None:
    """압축비로 부풀린 요청은 해제 도중 상한에서 끊는다.

    전선 위 바이트는 작아서 BodySizeLimitMiddleware 를 통과한다 — 막는 쪽은
    compression.py 의 해제 상한이다.
    """
    bomb = gzip.compress(b"0" * (settings.max_decompressed_bytes + 1024))
    assert len(bomb) < settings.max_request_bytes, (
        "폭탄이 전선 상한에 먼저 걸리면 이 테스트가 무의미하다"
    )

    res = client.post(
        "/api/v1/compose-sentence",
        content=bomb,
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )
    assert res.status_code == 413


def test_normal_gzip_payload_still_passes(client: TestClient) -> None:
    """상한 아래의 정상 압축 요청은 그대로 동작한다 (해제 경로 회귀 방지)."""
    body = b'{"session_id":"s","request_id":"r","word_ids":["w_1534"]}'
    res = client.post(
        "/api/v1/compose-sentence",
        content=gzip.compress(body),
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )
    assert res.status_code == 200
