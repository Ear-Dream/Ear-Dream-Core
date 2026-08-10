"""Swagger(/docs) 요청 예시 로더.

이 디렉토리의 `manifest.json` + `recognize_*.json` 은
`scripts/make_swagger_examples.py` 가 모델 레포의 실클립 키포인트 캐시(npy)에서
재구성해 생성한 산출물이다 — 손으로 수정하지 말고 스크립트로 재생성한다.

파일이 없으면(생성 전 환경) 예시 없이 동작한다 — 라우트가 깨지면 안 된다.
좌표는 원본 그대로다(반올림 금지 — 설계 결정 1: 예시도 계약을 따른다).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

EXAMPLES_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = EXAMPLES_DIR / "manifest.json"


@lru_cache(maxsize=1)
def recognize_openapi_examples() -> dict[str, Any] | None:
    """/recognize 의 Body(openapi_examples=...) dict. 예시 파일이 없으면 None."""
    if not MANIFEST_PATH.exists():
        return None
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        examples: dict[str, Any] = {}
        for name, entry in manifest.get("recognize", {}).items():
            payload_path = EXAMPLES_DIR / entry["file"]
            examples[name] = {
                "summary": entry["summary"],
                "description": entry["description"],
                "value": json.loads(payload_path.read_text(encoding="utf-8")),
            }
        return examples or None
    except (OSError, json.JSONDecodeError, KeyError):
        # 예시는 문서 편의 기능이다 — 로드 실패가 서버 기동을 막으면 안 된다
        return None
