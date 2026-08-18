from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.compression import GzipRequestMiddleware, SelectiveGzipResponseMiddleware
from app.core.config import settings
from app.core.limits import BodySizeLimitMiddleware
from app.core.logging import configure_logging, get_logger
from app.ml.model import get_model_state
from app.ml.vocab import VOCAB_SIZE
from app.schemas.system import HealthResponse
from app.services.sentence_llm import aclose_sentence_generator
from app.services.speech_tts import aclose_tts_provider

configure_logging()
logger = get_logger("http")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    # 외부 서비스(문장 LLM · TTS)의 공유 httpx 클라이언트 정리 (없으면 no-op).
    await aclose_sentence_generator()
    await aclose_tts_provider()


# syntaxHighlight=False: /docs 의 실클립 요청 예시(수백 KB)를 구문 강조하면 Swagger UI 가
# 메인 스레드를 수십 초 점유하며 멈춘다 (실측 — 155KB 예시에서 렌더러 프리즈). 예시는
# 일반 텍스트로 표시해도 Try it out 에는 지장이 없다.
app = FastAPI(
    title=settings.app_name,
    swagger_ui_parameters={"syntaxHighlight": False},
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# `Content-Encoding: gzip` 요청 본문 해제. /recognize 페이로드가 세그먼트당 수 MB 라
# 전송 계층에서만 줄인다 — 풀면 바이트가 같아 학습 계약은 그대로다 (app/core/compression.py).
app.add_middleware(GzipRequestMiddleware)

# 응답 압축. 카탈로그(/vocabulary)가 유일한 실질 수혜자지만, 터널 경유로 공개하면
# 사용자마다 한 번씩 나가는 값이다. /speech 의 오디오는 제외한다.
app.add_middleware(
    SelectiveGzipResponseMiddleware,
    minimum_size=settings.response_gzip_min_bytes,
    skip_suffixes=("/speech",),
)

# 크기 상한은 **가장 바깥**이어야 한다 — 해제도 아카이빙도 하기 전에 끊어야 의미가 있다.
# (add_middleware 는 나중에 등록한 것이 바깥이다.)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.exception_handler(RequestValidationError)
async def log_request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """422(Pydantic 검증 실패)도 처리 로그에 남긴다 — 사유 요약만.

    exc.errors() 의 `input` 값은 절대 로그에 싣지 않는다: /recognize 라면 랜드마크
    좌표 전체(수백 KB, 생체 인접 정보)가 그대로 들어 있다. loc + msg 만 요약한다.
    응답 형식은 FastAPI 기본 핸들러에 그대로 위임한다.
    """
    errors = exc.errors()
    reasons = "; ".join(
        f"{'.'.join(str(p) for p in e.get('loc', []))}: {e.get('msg', '?')}" for e in errors[:3]
    )
    if len(errors) > 3:
        reasons += f"; …외 {len(errors) - 3}건"
    # /recognize 는 커스텀 라우트가 검증 전에 아카이빙하며 request.state 에 id 를 남긴다
    info = getattr(request.state, "archive_info", None)
    logger.info(
        "http422 %s %s req=%s sess=%s errors=[%s]",
        request.method,
        request.url.path,
        info.request_id if info else "-",
        info.session_id if info else "-",
        reasons,
    )
    return await request_validation_exception_handler(request, exc)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=get_model_state().loaded,
        vocab_size=VOCAB_SIZE,
    )
