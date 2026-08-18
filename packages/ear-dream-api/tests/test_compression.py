"""gzip 요청 본문 해제 검증 (app/core/compression.py).

/recognize 페이로드가 세그먼트당 수 MB 라 전송 계층에서만 줄인다. **압축을 풀면 바이트가
동일해야 한다** — 그렇지 않으면 학습 계약이 조용히 바뀐 것이다.
"""

from __future__ import annotations

import gzip
import json

import pytest
from fastapi.testclient import TestClient

from app.ml import model as model_module

from .conftest import make_frames, make_recognize_request

# 모델 번들은 .gitignore 대상이라 CI 에는 없다. /recognize 가 200 을 내야 하는 테스트는
# 번들이 있을 때만 돈다 — test_recognize.py 등이 쓰는 것과 같은 가드다.
BUNDLE_AVAILABLE = (model_module.resolve_bundle_dir() / "release.json").exists()


def _gz(payload: dict) -> bytes:
    return gzip.compress(json.dumps(payload).encode())


def test_gzip_body_is_transparent(client: TestClient) -> None:
    """압축해 보낸 요청이 압축 없이 보낸 것과 같은 결과를 낸다."""
    body = {"session_id": "sess-z", "request_id": "req-z", "word_ids": ["w_1534"]}

    plain = client.post("/api/v1/compose-sentence", json=body)
    packed = client.post(
        "/api/v1/compose-sentence",
        content=_gz(body),
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )

    assert plain.status_code == packed.status_code == 200
    assert plain.json() == packed.json()


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_gzip_recognize_reaches_validation(client: TestClient) -> None:
    """큰 실제 페이로드도 해제되어 정상 처리된다 (여기가 실제 사용처다)."""
    payload = make_recognize_request(make_frames(20), request_id="req-gz")
    res = client.post(
        "/api/v1/recognize",
        content=_gz(payload),
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )
    # 합성 프레임이라 인식 결과 자체는 무엇이든 좋다 — 422/500 이 아니면 계약이 통했다.
    assert res.status_code == 200, res.text


def test_malformed_gzip_is_400_not_422(client: TestClient) -> None:
    """깨진 압축은 400 이다.

    그대로 흘려보내면 Pydantic 이 엉뚱한 422 를 내고 원인이 압축이었다는 사실이 묻힌다.
    """
    res = client.post(
        "/api/v1/compose-sentence",
        content=b"this is not gzip",
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )
    assert res.status_code == 400


def test_uncompressed_still_works(client: TestClient) -> None:
    """압축을 못 하는 클라이언트(구형 Safari 등)도 그대로 동작해야 한다."""
    res = client.post(
        "/api/v1/compose-sentence",
        json={"session_id": "s", "request_id": "r", "word_ids": ["w_1534"]},
    )
    assert res.status_code == 200


@pytest.mark.skipif(not BUNDLE_AVAILABLE, reason="model bundle not available")
def test_archive_stores_client_gzip_without_recompressing(client: TestClient, tmp_path) -> None:
    """클라이언트가 보낸 gzip 원본을 그대로 저장한다 — 내용은 동일해야 한다."""
    payload = make_recognize_request(make_frames(12), request_id="req-arch-gz")
    compressed = _gz(payload)
    res = client.post(
        "/api/v1/recognize",
        content=compressed,
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"},
    )
    assert res.status_code == 200

    archived = list((tmp_path / "archive").rglob("*.json.gz"))
    assert archived, "아카이브 파일이 생성되지 않았다"
    # 저장된 것을 풀면 원래 요청과 같아야 한다 (재압축을 건너뛰어도 내용은 불변).
    stored = json.loads(gzip.decompress(archived[-1].read_bytes()))
    assert stored["request_id"] == "req-arch-gz"
    assert stored == payload


def test_large_response_is_gzipped(client: TestClient) -> None:
    """카탈로그처럼 큰 응답은 압축해 내보낸다 (실측 54KB → 5KB)."""
    res = client.get("/api/v1/vocabulary", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip"
    # httpx 가 해제해 주므로 내용은 그대로여야 한다.
    assert len(res.json()["entries"]) > 0


def test_small_response_is_not_gzipped(client: TestClient) -> None:
    """작은 응답은 압축하지 않는다 — 줄어드는 양보다 왕복 오버헤드가 크다."""
    res = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert "content-encoding" not in res.headers


def test_client_without_gzip_gets_plain_response(client: TestClient) -> None:
    """압축을 못 받는 클라이언트에는 그대로 보낸다."""
    res = client.get("/api/v1/vocabulary", headers={"Accept-Encoding": "identity"})
    assert res.status_code == 200
    assert "content-encoding" not in res.headers


def test_speech_path_is_excluded_from_response_gzip(client: TestClient) -> None:
    """/speech 는 압축 대상이 아니다 — WAV 는 이득이 적고 첫 소리가 늦어진다.

    conftest 는 TTS 를 꺼 두므로 503 이 온다. 여기서 확인할 것은 경로가 압축 미들웨어를
    거치지 않는다는 사실이라 상태 코드와 무관하게 성립한다.
    """
    res = client.post(
        "/api/v1/speech",
        json={
            "session_id": "s",
            "request_id": "r",
            "text": "안녕하세요",
            "emotion": "neutral",
            "style": "polite",
        },
        headers={"Accept-Encoding": "gzip"},
    )
    assert "content-encoding" not in res.headers
