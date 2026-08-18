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

import zlib

from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.limits import send_413
from app.core.logging import get_logger

logger = get_logger("compression")

# 이보다 큰 본문이 오면 로그에 압축률을 남긴다 — 실사용 절감량을 눈으로 보기 위한 값.
_LOG_MIN_BYTES = 256 * 1024

# gzip 컨테이너를 읽는 wbits (zlib 헤더가 아니라 gzip 헤더).
_GZIP_WBITS = 16 + zlib.MAX_WBITS
# 한 번에 해제할 크기. 상한 초과를 이 단위로 알아채므로 메모리가 상한 + 이 값에서 멈춘다.
_DECOMPRESS_CHUNK = 1024 * 1024


class _TooLarge(Exception):
    """해제 결과가 상한을 넘었다 — 압축비를 이용한 증폭 요청."""


def _gunzip_capped(compressed: bytes, limit: int) -> bytes:
    """gzip.decompress 와 같되 **해제 결과에 상한**을 둔다.

    상한이 없으면 몇 MB 짜리 요청 하나가 수 GB 로 부풀 수 있다. 공개 URL(터널)에서는
    인증 없는 `/recognize` 가 그대로 노출되므로 여기서 끊는다.
    """
    decompressor = zlib.decompressobj(_GZIP_WBITS)
    out = bytearray()
    pending = compressed
    while True:
        chunk = decompressor.decompress(pending, _DECOMPRESS_CHUNK)
        out.extend(chunk)
        if len(out) > limit:
            raise _TooLarge(len(out))
        pending = decompressor.unconsumed_tail
        if decompressor.eof or (not chunk and not pending):
            break
    if not decompressor.eof:
        # 잘린 스트림. gzip.decompress 와 같은 취급으로 400 을 내보낸다.
        raise EOFError("incomplete gzip stream")
    return bytes(out)


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
            raw = _gunzip_capped(compressed, settings.max_decompressed_bytes)
        except _TooLarge:
            logger.warning(
                "gzip 해제 결과가 상한 %d bytes 를 넘었다 (압축 %d bytes) — 413",
                settings.max_decompressed_bytes,
                len(compressed),
            )
            await send_413(send, "decompressed request body too large")
            return
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


class SelectiveGzipResponseMiddleware:
    """응답 gzip. 단 **오디오 경로는 건너뛴다**.

    Starlette 의 GZipMiddleware 는 콘텐츠 타입을 가리지 않는데, `/speech` 는 WAV 바이트를
    돌려준다 — PCM 은 압축 이득이 적으면서 응답 전체를 버퍼링해 첫 소리를 늦춘다.
    경로는 요청 시점에 알 수 있으므로 여기서 갈라 검증된 구현을 그대로 쓴다.

    실측 이득은 `/vocabulary` 에 몰려 있다 (54KB → 5KB, 10.8배). 나머지 응답은 수백
    바이트라 minimum_size 아래로 떨어져 압축되지 않는다 — 작은 응답을 압축하면 줄어드는
    양보다 왕복 오버헤드가 크다 (요청 쪽 COMPRESS_MIN_BYTES 와 같은 취지).
    """

    def __init__(self, app: ASGIApp, minimum_size: int, skip_suffixes: tuple[str, ...]) -> None:
        self.plain = app
        self.gzipped = GZipMiddleware(app, minimum_size=minimum_size)
        self.skip_suffixes = skip_suffixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path", "").endswith(self.skip_suffixes):
            await self.plain(scope, receive, send)
            return
        await self.gzipped(scope, receive, send)


__all__ = ["GzipRequestMiddleware", "SelectiveGzipResponseMiddleware"]
