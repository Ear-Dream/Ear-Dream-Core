"""요청 본문 크기 상한.

LAN 실기기 테스트에서는 필요 없던 방어다. 하지만 터널(ngrok 등)로 **공개 URL** 이
되는 순간 성격이 달라진다 — `/recognize` 는 인증이 없고, 라우트가 Pydantic 검증
**이전**에 raw body 를 전부 버퍼링해 디스크에 아카이빙한다
(app/api/v1/recognize.py 의 ArchivingRoute). 상한이 없으면 요청 하나로 메모리와
디스크가 함께 나간다. `max_frames` 는 검증 단계 값이라 그 앞을 막지 못한다.

여기서 막는 건 **전선 위 바이트**다. 압축 본문의 해제 후 크기는
app/core/compression.py 가 따로 막는다 (압축비를 이용한 증폭 방어).
"""

from __future__ import annotations

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_logger

logger = get_logger("limits")


async def send_413(send: Send, detail: str) -> None:
    body = f'{{"detail":"{detail}"}}'.encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    """`Content-Length` 를 보고 과대 요청을 읽기 전에 413 으로 끊는다.

    길이를 밝히지 않는 요청(chunked)은 헤더로 걸러낼 수 없으므로 receive 를 감싸
    누적 바이트를 센다. 상한을 넘으면 그 지점에서 스트림을 끊는다 — 응답은 이미
    다운스트림 소관이라 413 이 아니라 400/422 로 나갈 수 있지만, **메모리는 상한에서
    멈춘다**. 실제 클라이언트(브라우저 fetch)는 항상 Content-Length 를 보내므로
    이 경로는 사실상 방어용이다.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            logger.warning(
                "요청 본문 %s bytes > 상한 %d — 413 (%s %s)",
                declared,
                self.max_bytes,
                scope.get("method", "?"),
                scope.get("path", "?"),
            )
            await send_413(send, "request body too large")
            return

        await self.app(scope, self._counting(receive, scope), send)

    def _counting(self, receive: Receive, scope: Scope) -> Receive:
        total = 0

        async def wrapped() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] != "http.request":
                return message
            total += len(message.get("body", b""))
            if total > self.max_bytes:
                logger.warning(
                    "요청 본문이 상한 %d bytes 를 넘어 스트림을 끊었다 (%s %s)",
                    self.max_bytes,
                    scope.get("method", "?"),
                    scope.get("path", "?"),
                )
                return {"type": "http.disconnect"}
            return message

        return wrapped


__all__ = ["BodySizeLimitMiddleware", "send_413"]
