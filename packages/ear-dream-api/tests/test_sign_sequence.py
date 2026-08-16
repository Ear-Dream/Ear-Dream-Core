"""/sign-sequence — 청인 문장 → 아바타 재생 단어 시퀀스.

핵심은 **두 실패의 구분**이다 (schemas/sign_sequence.py SignSequenceIssue 주석):
  - unknown_word : 어휘 300에 없다
  - no_sequence  : 어휘엔 있으나 아바타 시퀀스 자산이 없다 (현재 259단어)
이 둘이 섞이면 진짜 변환 모델이 붙었을 때 "변환은 됐는데 재생할 게 없는" 상태를
구분할 수 없다.

문장 → 단어열 변환은 아직 모델이 없어 sentence_rules 템플릿의 역인덱스 mock 이다
(app/ml/sentence_decompose.py). 모델이 붙어도 이 경로는 폴백으로 남으므로 여기 테스트도
그대로 유효하다.
"""

import pytest

from app.ml.sentence_decompose import decompose, normalize
from app.ml.sentence_rules import _MULTI, _SINGLE
from app.ml.sign_sequences import SEQUENCE_BUNDLE_VERSION, SEQUENCES
from app.ml.vocab import ID_TO_ENTRY

ENDPOINT = "/api/v1/sign-sequence"


def _body(text: str, request_id: str = "req-seq") -> dict:
    return {"session_id": "sess-1", "request_id": request_id, "text": text}


# ------------------------------------------------------------------ 데이터 전제
def test_sequence_manifest_is_a_subset_of_vocab():
    """시퀀스 매니페스트의 단어가 전부 어휘에 있어야 한다 — 어긋나면 어휘 판본 불일치다."""
    assert SEQUENCES, "시퀀스 매니페스트가 비어 있다 (build_sign_sequences.py 를 돌렸는가?)"
    assert set(SEQUENCES) <= set(ID_TO_ENTRY)
    # 현재는 어휘의 일부만 커버한다 — no_sequence 경로가 살아 있다는 뜻이다
    assert len(SEQUENCES) < len(ID_TO_ENTRY)


def test_reverse_index_only_uses_current_vocab():
    """역인덱스는 현재 어휘에 없는 v1 템플릿을 제외해야 한다 (라벨 조회 KeyError 방지)."""
    for word_id, sentence in _SINGLE.items():
        if word_id in ID_TO_ENTRY:
            continue
        _, source = decompose(sentence)
        assert source == "word_list", f"어휘 밖 템플릿이 역인덱스에 남아 있다: {sentence}"


# ------------------------------------------------------------------ 성공 경로
def test_multi_word_template_is_playable(client):
    """ "밥을 부탁해요" → [밥, 부탁]. 둘 다 시퀀스가 있어 전 구간 재생 가능하다."""
    assert ("w_1534", "w_1589") in _MULTI  # 정방향 템플릿이 살아 있는지 먼저 확인
    res = client.post(ENDPOINT, json=_body("밥을 부탁해요"))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "template"
    assert data["playable"] is True
    assert [item["word_id"] for item in data["items"]] == ["w_1534", "w_1589"]
    assert [item["label"] for item in data["items"]] == ["밥", "부탁"]
    for item in data["items"]:
        assert item["issue"] is None
        assert item["sequence_key"] == item["word_id"]  # 현재 키 체계 (별도 필드로 유지)
        assert item["frame_count"] > 0
    assert data["sequence_bundle_version"] == SEQUENCE_BUNDLE_VERSION
    assert data["asset_path"]
    assert data["source_fps"] > 0
    assert data["text"] == "밥을 부탁해요"


def test_single_word_template_is_playable(client):
    res = client.post(ENDPOINT, json=_body("부탁해요"))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "template"
    assert [item["word_id"] for item in data["items"]] == ["w_1589"]
    assert data["playable"] is True


def test_word_list_path_matches_bare_labels(client):
    """템플릿 미적중 문장은 공백 분해 후 어휘 라벨 대조 — compose 의 word_list 역연산."""
    res = client.post(ENDPOINT, json=_body("밥 부탁 시험"))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "word_list"
    assert [item["word_id"] for item in data["items"]] == ["w_1534", "w_1589", "w_1581"]
    assert data["playable"] is True


@pytest.mark.parametrize("text", ["밥을 부탁해요.", "밥을부탁해요", "  밥을   부탁해요  "])
def test_template_lookup_tolerates_punctuation_and_spacing(client, text):
    """STT 는 문말 부호·띄어쓰기가 흔들린다 — 정규화가 그걸 흡수해야 적중률이 유지된다."""
    res = client.post(ENDPOINT, json=_body(text))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "template"
    assert [item["word_id"] for item in data["items"]] == ["w_1534", "w_1589"]


# ------------------------------------------------------------------ unknown_word
def test_unknown_word(client):
    """어휘 300에 없는 단어 → unknown_word. word_id·sequence_key 는 null 이다."""
    res = client.post(ENDPOINT, json=_body("컴퓨터"))
    assert res.status_code == 200
    data = res.json()
    assert data["playable"] is False
    assert data["items"] == [
        {
            "source_text": "컴퓨터",
            "word_id": None,
            "label": None,
            "sequence_key": None,
            "frame_count": None,
            "issue": "unknown_word",
        }
    ]


def test_josa_token_is_unknown_word(client):
    """조사가 붙은 토큰은 형태소 분석을 하지 않으므로 unknown_word 다 — 의도된 한계.

    이걸 통과시키려 규칙을 늘리기 시작하면 검증되지 않은 한국어 처리가 불어난다
    (sentence_decompose 모듈 주석). 진짜 변환 모델이 할 일이다.
    """
    res = client.post(ENDPOINT, json=_body("밥을 주세요"))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "word_list"
    assert [item["issue"] for item in data["items"]] == ["unknown_word", "unknown_word"]


def test_unknown_word_keeps_position_among_playable_items(client):
    """재생 불가 항목도 빼지 않고 입력 순서 그대로 실린다 — 어디서 막혔는지가 핵심 정보다."""
    res = client.post(ENDPOINT, json=_body("밥 컴퓨터 부탁"))
    assert res.status_code == 200
    items = res.json()["items"]
    assert [item["source_text"] for item in items] == ["밥", "컴퓨터", "부탁"]
    assert [item["issue"] for item in items] == [None, "unknown_word", None]
    assert res.json()["playable"] is False


# ------------------------------------------------------------------ no_sequence
def _word_without_sequence() -> tuple[str, str]:
    """어휘엔 있으나 시퀀스가 없는 단어 하나 (label, id). 결정론적으로 고른다."""
    for word_id in sorted(ID_TO_ENTRY):
        if word_id not in SEQUENCES:
            return ID_TO_ENTRY[word_id].label, word_id
    raise AssertionError("모든 어휘에 시퀀스가 있다 — no_sequence 경로가 사라졌다")


def test_no_sequence(client):
    """어휘엔 있으나 아바타 시퀀스 자산이 없는 단어 → no_sequence.

    unknown_word 와 달리 word_id·label 은 채워지고 sequence_key 만 null 이다.
    "변환은 됐는데 재생할 게 없다" 를 그대로 드러내는 형태다.
    """
    label, word_id = _word_without_sequence()
    res = client.post(ENDPOINT, json=_body(label))
    assert res.status_code == 200
    data = res.json()
    assert data["playable"] is False
    assert data["items"] == [
        {
            "source_text": label,
            "word_id": word_id,
            "label": label,
            "sequence_key": None,
            "frame_count": None,
            "issue": "no_sequence",
        }
    ]


def test_unknown_word_and_no_sequence_are_distinguished(client):
    """두 실패가 한 응답 안에서 서로 다른 값으로 나와야 한다 — 이 API 의 존재 이유."""
    label, _ = _word_without_sequence()
    res = client.post(ENDPOINT, json=_body(f"{label} 컴퓨터 밥"))
    assert res.status_code == 200
    assert [item["issue"] for item in res.json()["items"]] == [
        "no_sequence",
        "unknown_word",
        None,
    ]


# ------------------------------------------------------------------ 빈 입력
@pytest.mark.parametrize("text", ["", " ", "\t\n  "])
def test_blank_text_is_422(client, text):
    """분해할 내용이 없는 입력은 빈 결과 200 이 아니라 422 — 클라이언트 버그를 덮지 않는다."""
    res = client.post(ENDPOINT, json=_body(text))
    assert res.status_code == 422


def test_missing_text_is_422(client):
    res = client.post(ENDPOINT, json={"session_id": "s", "request_id": "r"})
    assert res.status_code == 422


# ------------------------------------------------------------------ 왕복 일관성
def test_round_trip_with_compose_sentence(client):
    """compose(단어열) → decompose(문장) 가 원래 단어열로 돌아와야 한다.

    역인덱스가 정방향 템플릿에서 파생되므로 성립해야 하는 성질이다. 정방향 템플릿을
    고쳤을 때 역방향을 같이 갱신하지 않으면 여기서 깨진다.
    (LLM 은 conftest 에서 꺼져 있어 compose 가 규칙 경로로 돈다.)
    """
    word_ids = ["w_1534", "w_1589"]
    composed = client.post(
        "/api/v1/compose-sentence",
        json={"session_id": "s", "request_id": "r", "word_ids": word_ids},
    )
    assert composed.status_code == 200
    sentence = composed.json()["candidates"][0]["text"]

    res = client.post(ENDPOINT, json=_body(sentence))
    assert res.status_code == 200
    assert [item["word_id"] for item in res.json()["items"]] == word_ids


def test_normalize_strips_punctuation_and_collapses_space():
    assert normalize("  밥을   부탁해요!!  ") == "밥을 부탁해요"
    assert normalize("자고 싶어요?") == "자고 싶어요"
