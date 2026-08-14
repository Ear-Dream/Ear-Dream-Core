"""/compose-sentence 규칙 경로 검증 — 템플릿 적중 / word_list fallback / 422.

300단어 전환으로 템플릿 커버리지가 부분이 됐다 (sentence_rules 모듈 주석) —
겹치는 18단어는 템플릿 적중, 미등록 단어는 word_list fallback 으로 동작을 보장한다.

여기서는 문장 변환 LLM 이 꺼져 있다 (conftest 의 client 픽스처). LLM 경로와 폴백은
test_sentence_llm.py 가 검증한다.
"""

from app.ml.sentence_rules import _SINGLE
from app.ml.vocab import ENTRIES, ID_TO_ENTRY


def test_single_word_templates_partially_cover_vocab():
    """템플릿은 v1 30단어 기준이라 300단어의 부분집합만 커버한다 — 겹침이 존재해야
    템플릿 경로가 살아 있고, 나머지는 fallback 이 처리한다."""
    vocab_ids = {e.id for e in ENTRIES}
    covered = set(_SINGLE.keys()) & vocab_ids
    assert covered, "300단어와 겹치는 템플릿이 하나도 없다 — id 체계가 어긋났는지 확인"
    # 실측 겹침 (classes.json ↔ v1 어휘): 18단어
    assert "w_1534" in covered  # 밥
    assert "w_1589" in covered  # 부탁


def _body(word_ids: list[str]) -> dict:
    return {"session_id": "sess-1", "request_id": "req-s", "word_ids": word_ids}


def test_single_word_template(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1534"]))  # 밥
    assert res.status_code == 200
    data = res.json()
    assert data["candidates"][0] == {
        "text": "밥이요",
        "word_ids": ["w_1534"],
        "source": "template",
        # 감정·말투는 LLM 2단계 분류의 산출물이라 규칙 경로에는 없다 (schemas/sentence.py)
        "emotion": None,
        "style": None,
    }
    assert data["ruleset_version"]


def test_multi_word_template(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1534", "w_1589"]))  # 밥 부탁
    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "밥을 부탁해요"
    assert cand["source"] == "template"


def test_single_word_without_template_falls_back(client):
    """템플릿이 없는 단어(300단어 신규)는 문장을 지어내지 않고 라벨 그대로 — 임시 fallback."""
    assert "w_1157" in ID_TO_ENTRY and "w_1157" not in _SINGLE  # 나 (신규 단어)
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1157"]))
    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "나"
    assert cand["source"] == "word_list"


def test_word_list_fallback(client):
    # 템플릿에 없는 조합 → 문장을 만들지 않고 라벨 공백 연결
    res = client.post("/api/v1/compose-sentence", json=_body(["w_1157", "w_1534"]))  # 나 밥
    assert res.status_code == 200
    cand = res.json()["candidates"][0]
    assert cand["text"] == "나 밥"
    assert cand["source"] == "word_list"


def test_unknown_word_id_422(client):
    res = client.post("/api/v1/compose-sentence", json=_body(["w_9999"]))
    assert res.status_code == 422


def test_empty_word_ids_422(client):
    res = client.post("/api/v1/compose-sentence", json=_body([]))
    assert res.status_code == 422
