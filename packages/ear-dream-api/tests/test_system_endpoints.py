"""/vocabulary, /model, /health 형태 검증."""

from app.core.config import settings


def test_vocabulary(client):
    res = client.get("/api/v1/vocabulary")
    assert res.status_code == 200
    data = res.json()
    assert data["vocab_version"]
    assert len(data["entries"]) == 30
    entry = next(e for e in data["entries"] if e["id"] == "w_1510")
    assert entry["label"] == "꿈"
    assert entry["gloss_refs"][0]["gloss_id"] == "NIA_SL_WORD1510"
    assert entry["has_avatar"] is False


def test_model_info(client):
    res = client.get("/api/v1/model")
    assert res.status_code == 200
    data = res.json()
    assert data["num_classes"] == 30
    assert data["top_k"] == settings.recognize_top_k
    assert data["preprocess_version"] == "2"  # v2 등방 정규화 (모델 레포 dataset.py 와 동기)
    assert data["reject_threshold"] == settings.reject_threshold
    contract = data["landmark_contract"]
    assert contract["hand_point_count"] == 21
    assert contract["pose_point_count"] == 33
    assert set(contract["face_point_counts"]) == {468, 478}
    assert contract["min_frames"] == settings.min_frames
    assert contract["max_frames"] == settings.max_frames


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert isinstance(data["model_loaded"], bool)
    assert data["vocab_size"] == 30
