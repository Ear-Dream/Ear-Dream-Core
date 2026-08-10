"""/recognize 요청 본문 아카이빙 — 실사용 데이터를 학습 데이터셋 후보로 보관한다.

저장 경로: {api 패키지 루트}/{settings.archive_dir}/{session_id}/{request_id}.json.gz
(원본 body 그대로 gzip. var/ 는 .gitignore 대상)

검증 실패(422) 요청도 저장해야 하므로 라우트 핸들러가 아니라 **커스텀 APIRoute** 의
route handler 앞단(Pydantic 검증 이전)에서 호출한다 — app/api/v1/recognize.py 참조.
session_id/request_id 는 관대한 json 파싱으로 뽑고, 실패하면 "unknown"/uuid 를 쓴다.

아카이빙 실패는 인식 요청을 막지 않는다 (베스트 에포트).
"""

from __future__ import annotations

import gzip
import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("archive")

# 경로 조작 방지: 파일명 성분은 안전한 문자만 남긴다
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _sanitize(value: str, fallback: str) -> str:
    cleaned = _SAFE.sub("_", value).strip("._")
    return cleaned[:128] if cleaned else fallback


@dataclass(frozen=True)
class ArchiveInfo:
    """아카이빙 결과 — 요청 처리 로그(request.state 경유)에 쓰인다."""

    session_id: str  # raw body 에서 관대하게 파싱한 값 (실패 시 "unknown")
    request_id: str  # 파싱 실패 시 생성된 uuid hex
    path: Path | None  # 저장 경로. 비활성/실패 시 None


def archive_recognize_body(raw_body: bytes) -> ArchiveInfo:
    """raw 요청 본문을 저장한다. 어떤 예외도 밖으로 던지지 않는다."""
    session_id, request_id = "unknown", uuid.uuid4().hex
    try:
        payload = json.loads(raw_body)
        if isinstance(payload, dict):
            if isinstance(payload.get("session_id"), str):
                session_id = payload["session_id"]
            if isinstance(payload.get("request_id"), str):
                request_id = payload["request_id"]
    except (json.JSONDecodeError, UnicodeDecodeError):
        pass  # JSON 조차 아닌 본문도 그대로 보관한다

    if not settings.archive_enabled:
        return ArchiveInfo(session_id, request_id, None)
    try:
        target_dir = settings.package_root / settings.archive_dir / _sanitize(session_id, "unknown")
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{_sanitize(request_id, uuid.uuid4().hex)}.json.gz"
        with gzip.open(target, "wb") as f:
            f.write(raw_body)
        return ArchiveInfo(session_id, request_id, target)
    except Exception:
        logger.exception("recognize archive failed")
        return ArchiveInfo(session_id, request_id, None)
