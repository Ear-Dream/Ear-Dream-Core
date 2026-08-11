"""아카이브·진단 파일 네이밍 검증 — 사람이 찾기 쉬운 `{MMDD_HHMM}_{sess8}/{seq}_{req8}` 규칙.

API 계약(JSON 내용의 session_id/request_id)은 그대로다 — 여기서 검증하는 건 디스크
경로뿐이다. 422 요청도 아카이빙되므로 순번 테스트는 프레임 부족(n=2) 요청으로 빠르게 돈다.
"""

import re

import pytest

from app.core.config import settings
from app.ml import model as model_module
from app.services.archive import sanitize_component
from tests.conftest import make_frames, make_recognize_request

CHECKPOINT_AVAILABLE = (model_module.resolve_bundle_dir() / "release.json").exists()

# conftest 의 session_id 는 "sess-1" — sess8 도 "sess-1" 이다
SESSION_DIR_RE = re.compile(r"^\d{4}_\d{4}_sess-1$")


def _archive_root():
    return settings.package_root / settings.archive_dir


def _post(client, request_id: str, n: int = 2) -> None:
    client.post(
        "/api/v1/recognize", json=make_recognize_request(make_frames(n=n), request_id=request_id)
    )


def test_sequence_increments_and_session_dir_reused(client):
    """같은 세션의 요청은 한 폴더에 001, 002, 003 … 순번으로 쌓인다."""
    for rid in ("req-a", "req-b", "req-c"):
        _post(client, rid)
    dirs = [p for p in _archive_root().iterdir() if p.is_dir()]
    assert len(dirs) == 1, "같은 세션은 폴더를 재사용해야 한다"
    assert SESSION_DIR_RE.match(dirs[0].name), dirs[0].name
    names = sorted(p.name for p in dirs[0].glob("*.json.gz"))
    assert names == ["001_req-a.json.gz", "002_req-b.json.gz", "003_req-c.json.gz"]


def test_existing_session_dir_reused_across_restart(client):
    """같은 sess8 로 끝나는 기존 폴더(예: 서버 재시작 전 것)가 있으면 재사용한다."""
    legacy = _archive_root() / "0101_0000_sess-1"
    legacy.mkdir(parents=True)
    (legacy / "001_req-old.json.gz").write_bytes(b"")  # 기존 파일 1건 → 다음 순번은 002
    _post(client, "req-new")
    assert [p.name for p in sorted(legacy.glob("*.json.gz"))] == [
        "001_req-old.json.gz",
        "002_req-new.json.gz",
    ]
    assert len([p for p in _archive_root().iterdir() if p.is_dir()]) == 1


def test_korean_request_ids_do_not_collide(client):
    """회귀: 이전 sanitize 는 비ASCII 를 **제거**해서 "e2e-q-어깨없음"과 "e2e-q-손없음"이
    같은 이름("e2e-q-")으로 충돌했다. 한글은 이제 허용 문자라 파일명에 보존된다."""
    _post(client, "어깨없음-테스트")
    _post(client, "손없음-테스트")
    files = list(_archive_root().glob("*_sess-1/*.json.gz"))
    assert len(files) == 2
    names = {p.name for p in files}
    assert len(names) == 2, f"한글 request_id 두 개가 같은 파일명으로 충돌: {names}"
    assert any("어깨없음" in n for n in names)
    assert any("손없음" in n for n in names)


def test_sanitize_replaces_instead_of_removing():
    # 한글 완성형은 허용 문자 — 그대로 보존된다
    assert sanitize_component("e2e-q-어깨없음", "x") == "e2e-q-어깨없음"
    # 허용 외 문자는 제거가 아니라 "_" 치환 + 원본 해시 접미사 → 서로 다른 원본이 안 겹친다
    a = sanitize_component("req☆1", "x")
    b = sanitize_component("req◇1", "x")
    assert a != b
    assert a.startswith("req_1-")
    # 경로 조작 문자는 살아남지 않는다
    assert "/" not in sanitize_component("../../etc/passwd", "x")
    assert sanitize_component("..", "fallback") == "fallback"


@pytest.mark.skipif(not CHECKPOINT_AVAILABLE, reason="model bundle not available")
def test_diagnostics_shares_seq_and_names_result(client, tmp_path):
    """진단 파일은 아카이브와 같은 폴더명·seq 를 쓰고, 파일명에 결과(status·top1)를 싣는다."""
    res = client.post(
        "/api/v1/recognize",
        json=make_recognize_request(make_frames(n=40), request_id="diag-naming"),
    )
    assert res.status_code == 200
    status = res.json()["status"]  # recognized 또는 rejected (모델 출력에 따라)

    arch = list(_archive_root().glob("*_sess-1/*.json.gz"))
    assert len(arch) == 1
    assert arch[0].name == "001_diag-nam.json.gz"  # req8 = 앞 8자

    diag = list((tmp_path / "diagnostics").glob("*_sess-1/*.json"))
    assert len(diag) == 1
    assert diag[0].parent.name == arch[0].parent.name, "아카이브와 세션 폴더명이 같아야 조인된다"
    assert diag[0].name.startswith("001_diag-nam_"), diag[0].name
    assert status in diag[0].name  # 응답 후 기록이므로 결과가 이름에 실린다
