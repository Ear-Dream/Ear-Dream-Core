"""/recognize 요청 본문 아카이빙 — 실사용 데이터를 학습 데이터셋 후보로 보관한다.

저장 경로(사람이 찾기 쉬운 네이밍 — API 계약과 무관, JSON 내용의 session_id/request_id 는
클라이언트 UUID 그대로 유지된다):

    {api 패키지 루트}/{settings.archive_dir}/{MMDD_HHMM}_{sess8}/{seq:03d}_{req8}.json.gz
    예: var/archive/0810_1430_1576b87c/003_b2b7be10.json.gz

- 세션 폴더의 시각 접두는 그 세션의 **첫 요청 도착 시각** — 최신 세션이 정렬로 바로 보인다
- seq 는 세션 폴더 내 순번 (01, 02, 03 …) — 같은 세션의 요청을 순서대로 찾을 수 있다
- 원본 body 그대로 gzip. var/ 는 .gitignore 대상

검증 실패(422) 요청도 저장해야 하므로 라우트 핸들러가 아니라 **커스텀 APIRoute** 의
route handler 앞단(Pydantic 검증 이전)에서 호출한다 — app/api/v1/recognize.py 참조.
session_id/request_id 는 관대한 json 파싱으로 뽑고, 실패하면 "unknown"/uuid 를 쓴다.

아카이빙 실패는 인식 요청을 막지 않는다 (베스트 에포트).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("archive")

# 경로 조작 방지: 허용 문자는 영숫자·._- 와 한글 완성형(가-힣).
# ⚠️ 허용 외 문자는 **제거가 아니라 치환**한다 — 이전 구현은 비ASCII 를 통째로 지워서
# "e2e-q-어깨없음" 과 "e2e-q-손없음" 이 같은 이름("e2e-q-")으로 충돌했다 (실측 버그).
_UNSAFE = re.compile(r"[^A-Za-z0-9._\-가-힣]")


def sanitize_component(value: str, fallback: str) -> str:
    """파일명 성분 안전화. 허용 외 문자는 "_" 치환 + 원본 해시 접미사로 충돌을 막는다."""
    cleaned = _UNSAFE.sub("_", value)
    if cleaned != value:
        # 치환만 하면 서로 다른 원본이 같은 이름이 될 수 있다 → 원본 해시로 구분한다
        digest = hashlib.sha1(value.encode("utf-8", "surrogatepass")).hexdigest()[:6]
        cleaned = f"{cleaned}-{digest}"
    cleaned = cleaned.strip("._")
    return cleaned[:128] if cleaned else fallback


def short_id(value: str, fallback: str) -> str:
    """파일명용 축약 id — sanitize 후 앞 8자 (UUID 전체는 사람이 못 읽는다).

    8자 절단으로 서로 다른 id 가 같은 축약을 가질 수는 있지만, 파일은 seq 접두로
    항상 구분되고 정본 식별자는 JSON 내용의 session_id/request_id 다.
    """
    return sanitize_component(value, fallback)[:8]


def resolve_session_dir(base: Path, session_id: str, *, now: datetime | None = None) -> Path:
    """세션 폴더 경로 — `{MMDD_HHMM}_{sess8}`. 시각은 그 세션의 첫 요청 도착 시각.

    같은 sess8 로 끝나는 폴더가 이미 있으면 재사용한다 (서버 재시작 후에도 같은 세션은
    같은 폴더로 이어진다). 서로 다른 세션이 앞 8자까지 같으면 폴더를 공유하게 되지만,
    정본 식별자는 JSON 내용이므로 판별은 가능하다 (replay_archive.py 가 그렇게 읽는다).
    """
    sess8 = short_id(session_id, "unknown")
    if base.is_dir():
        existing = sorted(p for p in base.glob(f"*_{sess8}") if p.is_dir())
        if existing:
            return existing[-1]  # 접두가 시각이므로 사전순 마지막 = 최신
    # 폴더명은 사람이 찾는 용도라 **로컬 시각**을 쓴다 (JSON 내용의 created_at 은 UTC 유지)
    stamp = (now or datetime.now(UTC).astimezone()).strftime("%m%d_%H%M")
    return base / f"{stamp}_{sess8}"


def next_seq(session_dir: Path, pattern: str) -> int:
    """세션 폴더 내 다음 순번 = 기존 파일 수 + 1.

    ⚠️ 단일 프로세스 dev 서버 전제의 단순 카운팅이다 — 멀티 워커나 동시 요청에서는
    같은 순번이 겹칠 수 있다 (그 경우에도 req8 이 다르면 파일은 안 겹친다).
    프로덕션 다중 워커가 필요해지면 파일 잠금/원자적 카운터로 바꾼다.
    """
    if not session_dir.is_dir():
        return 1
    return len(list(session_dir.glob(pattern))) + 1


@dataclass(frozen=True)
class ArchiveInfo:
    """아카이빙 결과 — 요청 처리 로그·진단 기록(request.state 경유)에 쓰인다."""

    session_id: str  # raw body 에서 관대하게 파싱한 값 (실패 시 "unknown")
    request_id: str  # 파싱 실패 시 생성된 uuid hex
    path: Path | None  # 저장 경로. 비활성/실패 시 None
    session_dirname: str | None = None  # 진단 기록이 같은 폴더명을 쓰도록 전달
    seq: int | None = None  # 진단 기록이 같은 순번을 쓰도록 전달 (아카이브와 조인 키)


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
        base = settings.package_root / settings.archive_dir
        session_dir = resolve_session_dir(base, session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        seq = next_seq(session_dir, "*.json.gz")
        req8 = short_id(request_id, uuid.uuid4().hex[:8])
        target = session_dir / f"{seq:03d}_{req8}.json.gz"
        with gzip.open(target, "wb") as f:
            f.write(raw_body)
        return ArchiveInfo(session_id, request_id, target, session_dir.name, seq)
    except Exception:
        logger.exception("recognize archive failed")
        return ArchiveInfo(session_id, request_id, None)
