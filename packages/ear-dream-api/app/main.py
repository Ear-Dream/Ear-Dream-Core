from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.ml.model import get_model_state
from app.ml.vocab import VOCAB_SIZE
from app.schemas.system import HealthResponse

configure_logging()
logger = get_logger("http")

# syntaxHighlight=False: /docs 의 실클립 요청 예시(수백 KB)를 구문 강조하면 Swagger UI 가
# 메인 스레드를 수십 초 점유하며 멈춘다 (실측 — 155KB 예시에서 렌더러 프리즈). 예시는
# 일반 텍스트로 표시해도 Try it out 에는 지장이 없다.
app = FastAPI(title=settings.app_name, swagger_ui_parameters={"syntaxHighlight": False})

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
