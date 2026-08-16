"""gzip 압축된 요청 본문 해제.

`/recognize` 페이로드가 세그먼트당 **수 MB**다 (실측: 61프레임 2.16MB, 98프레임 3.47MB,
최대 6.29MB). 얼굴 메쉬 478점이 84.8%를 차지하는데, 모델이 쓰는 건 그중 37점뿐이어도
아카이브가 데이터셋 후보라 원본 전량을 보낸다 (CLAUDE.md 「전처리 정본은 한 곳」).

그래서 **전송 계층에서만** 줄인다 — 압축을 풀면 바이트가 동일하므로 학습 계약이 바뀌지
않는다. 좌표 반올림·얼굴 축약 같은 계약 변경과 다른 점이다.

Starlette 는 요청 본문을 자동으로 해제하지 않는다(응답만 GZipMiddleware 가 있다).
그래서 ASGI 층에서 직접 처리한다.

**압축 원본을 `request.state.compressed_body` 로 넘긴다.** 아카이브가 어차피 gzip 으로
저장하므로, 해제본을 다시 압축하지 않고 받은 것을 그대로 쓰면 요청당 수 MB 재압축이
사라진다 (app/services/archive.py).
"""

from __future__ import annotations

import gzip
import zlib

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_logger

logger = get_logger("compression")

# 이보다 큰 본문이 오면 로그에 압축률을 남긴다 — 실사용 절감량을 눈으로 보기 위한 값.
_LOG_MIN_BYTES = 256 * 1024


class GzipRequestMiddleware:
    """`Content-Encoding: gzip` 요청 본문을 해제해 다운스트림에 넘긴다.

    해제 실패는 400 이다 — 깨진 본문을 그대로 흘려보내면 Pydantic 이 엉뚱한 422 를 내고
    원인이 압축이었다는 사실이 묻힌다.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        if headers.get("content-encoding", "").lower() != "gzip":
            await self.app(scope, receive, send)
            return

        compressed = await _read_body(receive)
        try:
            raw = gzip.decompress(compressed)
        except (OSError, EOFError, zlib.error) as exc:
            logger.warning("gzip 요청 본문 해제 실패 (%d bytes): %s — 400", len(compressed), exc)
            await _send_400(send, "malformed gzip request body")
            return

        if len(raw) >= _LOG_MIN_BYTES:
            ratio = len(raw) / len(compressed) if compressed else 0.0
            logger.info(
                "gzip req %s %s %.2fMB → %.2fMB (%.1fx)",
                scope.get("method", "?"),
                scope.get("path", "?"),
                len(raw) / 1_048_576,
                len(compressed) / 1_048_576,
                ratio,
            )

        # 아카이브가 재압축 없이 그대로 저장할 수 있게 원본을 넘긴다.
        scope.setdefault("state", {})["compressed_body"] = compressed

        await self.app(_rewrite_headers(scope, len(raw)), _replay(raw), send)


async def _read_body(receive: Receive) -> bytes:
    chunks: list[bytes] = []
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def _replay(body: bytes) -> Receive:
    """해제된 본문을 한 번에 돌려주는 receive. 이후 호출은 disconnect 로 막는다."""
    sent = False

    async def receive() -> Message:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    return receive


def _rewrite_headers(scope: Scope, length: int) -> Scope:
    """content-encoding 을 지우고 content-length 를 해제 후 크기로 맞춘다.

    남겨 두면 다운스트림이 "아직 압축되어 있다" 고 오해하고, 길이가 틀리면 본문을
    잘라 읽는 구현이 있다.
    """
    headers: list[tuple[bytes, bytes]] = [
        (key, value)
        for key, value in scope["headers"]
        if key.lower() not in (b"content-encoding", b"content-length")
    ]
    headers.append((b"content-length", str(length).encode()))
    return {**scope, "headers": headers}


async def _send_400(send: Send, detail: str) -> None:
    body = f'{{"detail":"{detail}"}}'.encode()
    await send(
        {
            "type": "http.response.start",
            "status": 400,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


__all__ = ["GzipRequestMiddleware"]
