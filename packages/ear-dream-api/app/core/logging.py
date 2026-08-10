"""`ear_dream` 네임스페이스 로거 설정.

`fastapi dev`(uvicorn)는 자기 로거(`uvicorn.*`)에만 핸들러를 붙인다. 애플리케이션
로거는 핸들러가 없으면 루트 로거의 lastResort(WARNING 이상)로만 새어 나가서
INFO 레벨 처리 로그가 터미널에 보이지 않는다. 그래서 `ear_dream` 상위 로거에
StreamHandler 를 직접 붙이고 propagate 를 끈다 (uvicorn 설정과 독립).

레벨은 settings.log_level (환경변수 EAR_DREAM_LOG_LEVEL, 기본 INFO).

주의: 처리 로그에 좌표 데이터(랜드마크)를 찍지 않는다 — 크고, 생체 인접 정보다.
"""

from __future__ import annotations

import logging
import sys

from app.core.config import settings

_ROOT_NAME = "ear_dream"
_FORMAT = "%(levelname)s %(asctime)s [%(name)s] %(message)s"
_DATEFMT = "%H:%M:%S"


def get_logger(name: str) -> logging.Logger:
    """`ear_dream.<name>` 로거를 돌려준다 (예: get_logger("recognize"))."""
    return logging.getLogger(f"{_ROOT_NAME}.{name}")


def configure_logging() -> None:
    """앱 기동 시 1회 호출 (app/main.py). 중복 호출해도 핸들러가 늘지 않는다."""
    root = logging.getLogger(_ROOT_NAME)
    root.setLevel(settings.log_level.upper())
    root.propagate = False
    if not root.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))
        root.addHandler(handler)
