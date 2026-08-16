"""/vocabulary, /model, /health 형태 검증 (SPOTER-208 300단어)."""

from app.core.config import settings
from app.ml.sign_sequences import SEQUENCE_COUNT, SEQUENCES


def test_vocabulary(client):
    res = client.get("/api/v1/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["vocab_version"]
    assert len(data["entries"]) == 300
    # classes.json index 0 = WORD1157 = "나"
    entry = next(e for e in data["entries"] if e["id"] == "w_1157")
    assert entry["label"] == "나"
    assert entry["gloss_refs"][0]["gloss_id"] == "NIA_SL_WORD1157"
    # 4자리 미만 번호는 zero-pad — WORD0003
    entry = next(e for e in data["entries"] if e["id"] == "w_0003")
    assert entry["gloss_refs"][0]["gloss_id"] == "NIA_SL_WORD0003"


def test_vocabulary_avatar_fields_match_sequence_manifest(client):
    """has_avatar 의 정본은 sign_sequences 매니페스트다 — /sign-sequence 와 같은 출처.

    두 엔드포인트가 갈라지면 앱이 "재생 가능"으로 표시해 놓고 재생에 실패한다.
    """
    data = client.get("/api/v1/vocabulary").json()
    with_avatar = [e for e in data["entries"] if e["has_avatar"]]
    assert len(with_avatar) == SEQUENCE_COUNT
    assert {e["id"] for e in with_avatar} == set(SEQUENCES)

    # 보유 항목은 자산 키를 싣고, 미보유 항목은 null 이다 (클라이언트가 word_id 로
    # 파일명을 조립하지 않도록 키를 명시적으로 내려준다)
    for e in with_avatar:
        assert e["avatar_asset_id"] == SEQUENCES[e["id"]].sequence_key
    assert all(e["avatar_asset_id"] is None for e in data["entries"] if not e["has_avatar"])


def test_vocabulary_ids_unique_and_labels_unique(client):
    data = client.get("/api/v1/vocabulary").json()
    ids = [e["id"] for e in data["entries"]]
    labels = [e["label"] for e in data["entries"]]
    assert len(set(ids)) == 300
    assert len(set(labels)) == 300


def test_model_info(client):
    res = client.get("/api/v1/model")
    assert res.status_code == 200
    data = res.json()
    assert data["num_classes"] == 300
    assert data["top_k"] == settings.recognize_top_k
    # 전처리 계약 버전 = 학습 산출물 feature_version
    assert data["preprocess_version"] == "spoter2_mp_xy_v1"
    # reject 임계는 로드 시 확정 (release.json 권장값 0.5 또는 설정 오버라이드/fallback)
    assert 0.0 < data["reject_threshold"] < 1.0
    contract = data["landmark_contract"]
    assert contract["hand_point_count"] == 21
    assert contract["pose_point_count"] == 33
    # SPOTER face 37 인덱스는 홍채(468·473) 포함 — 478점 메쉬 필수
    assert contract["face_point_counts"] == [478]
    assert contract["min_frames"] == settings.min_frames
    assert contract["max_frames"] == settings.max_frames


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert isinstance(data["model_loaded"], bool)
    assert data["vocab_size"] == 300
