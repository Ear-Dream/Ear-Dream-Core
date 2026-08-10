"""/compose-sentence 검증 — 템플릿 적중 / word_list fallback / 422."""

from app.ml.sentence_rules import _SINGLE
from app.ml.vocab import ENTRIES


def test_single_word_templates_cover_all_vocab():
    assert set(_SINGLE.keys()) == {e.id for e in ENTRIES}


def _body(word_ids: list[str]) -> dict:
    return {"session_id": "sess-1", "request_id": "req-s", "word_ids": word_ids}


def test_single_word_template(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_2036"]))  # 목마르다
    assert res.status_code == 200
    data = res.json()
    assert data["candidates"][0] == {
        "text": "목이 말라요",
        "word_ids": ["w_2036"],
        "source": "template",
    }
    assert data["ruleset_version"]


def test_multi_word_template(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1534", "w_1589"]))  # 밥 부탁
    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "밥을 부탁해요"
    assert cand["source"] == "template"


def test_word_list_fallback(client):
    # 템플릿에 없는 조합 → 문장을 만들지 않고 라벨 공백 연결
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1593", "w_1510"]))  # 기차 꿈
    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "기차 꿈"
    assert cand["source"] == "word_list"


def test_unknown_word_id_422(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_9999"]))
    assert res.status_code == 422


def test_empty_word_ids_422(client):
    res = client.post("/api/v1/compose-sentence", json=_body([]))
    assert res.status_code == 422
