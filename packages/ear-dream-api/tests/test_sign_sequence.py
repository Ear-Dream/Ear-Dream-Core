"""/sign-sequence — 청인 문장 → 아바타 재생 단어 시퀀스.

핵심은 **두 실패의 구분**이다 (schemas/sign_sequence.py SignSequenceIssue 주석):
  - unknown_word : 어휘 300에 없다
  - no_sequence  : 어휘엔 있으나 아바타 시퀀스 자산이 없다
이 둘이 섞이면 진짜 변환 모델이 붙었을 때 "변환은 됐는데 재생할 게 없는" 상태를
구분할 수 없다.

문장 → 단어열 변환은 아직 모델이 없다 (app/ml/sentence_decompose.py). 지금은
템플릿 역인덱스 + 형태소 분석 두 경로이고, 모델이 붙어도 폴백으로 남으므로 여기
테스트는 그대로 유효하다.
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


def test_josa_is_stripped(client):
    """조사가 붙어도 어휘 라벨을 찾아낸다 (v2 형태소 경로). "주다" 는 어휘에 없어 남는다."""
    res = client.post(ENDPOINT, json=_body("밥을 주세요"))
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "word_list"
    assert [item["label"] for item in data["items"]] == ["밥", None]
    assert [item["issue"] for item in data["items"]] == [None, "unknown_word"]


@pytest.mark.parametrize(
    ("text", "labels"),
    [
        ("아기가 귀엽네요", ["아기", "귀엽다"]),
        ("아기가 귀여워요", ["아기", "귀엽다"]),  # ㅂ불규칙
        ("천천히 걸어요", ["걷다"]),  # ㄷ불규칙
        ("잘 모르겠어요", ["모르다"]),  # 르불규칙
        ("오늘 너무 추워요", ["춥다"]),  # ㅂ불규칙
        ("정말 잘해요", ["잘하다"]),  # 앞 형태소와 붙는 용언
        ("오늘 피곤해요", ["피곤하다"]),  # 어근 + 하다
        ("운전면허 있어요", ["운전면허"]),  # 명사 연쇄를 붙여 최장 일치
    ],
)
def test_conjugation_and_josa_are_resolved(text, labels):
    """활용형·조사를 벗겨 어휘 라벨에 닿는다 — 이 모듈의 책임 범위다.

    불규칙 활용이 핵심이다: 어휘 300의 용언 64개 중 26개가 불규칙이라, 어간 접두
    매칭 같은 손 규칙으로는 이 케이스들이 통째로 빠진다 (모듈 주석 「형태소 분석기를
    쓰는 이유」). 어휘에 없는 조각("천천히"·"오늘")은 여기서 검사하지 않는다 —
    어휘 구성이 바뀌면 흔들리는 부분이라 매칭된 라벨만 본다.
    """
    items, source = decompose(text)
    assert source == "word_list"
    matched = [ID_TO_ENTRY[word_id].label for _, word_id in items if word_id is not None]
    assert matched == labels


@pytest.mark.parametrize(
    "text", ["귀엽다", "귀엽네", "귀여워", "귀엽지", "귀여운 아기", "안 귀여워", "귀여웠어요"]
)
def test_all_conjugations_reach_the_same_word(text):
    """활용형이 달라도 같은 어휘에 닿아야 한다 — 아바타는 기본형 하나만 재생할 수 있다."""
    items, _ = decompose(text)
    matched = [ID_TO_ENTRY[word_id].label for _, word_id in items if word_id is not None]
    assert "귀엽다" in matched


def test_domain_word_survives_in_context():
    """분야 어휘가 문장 안에서 쪼개지면 안 된다.

    "농인" 은 단독으로는 한 덩어리지만 문장 안에서는 "농"+"인" 으로 갈렸다 — 어휘
    라벨을 분석기 사용자 사전에 등록해 막는다. 이 서비스의 핵심 낱말이라 조용히
    깨지면 안 된다.
    """
    items, _ = decompose("저는 농인이에요")
    assert [ID_TO_ENTRY[w].label for _, w in items if w is not None] == ["저", "농인"]


def test_word_spanning_a_space_is_matched():
    """띄어쓰기를 사이에 둔 한 단어도 잡는다 ("못 했어요" → 못하다).

    매칭을 어절 안에 가두면 놓치는 자리다. 그래서 문장 전체 형태소 열에서 찾는다.
    """
    items, _ = decompose("이해 못 했어요")
    assert [ID_TO_ENTRY[w].label for _, w in items if w is not None] == ["이해", "못하다"]


@pytest.mark.parametrize(
    ("text", "forbidden"),
    [
        ("가방을 놓고 왔어요", "가다"),
        ("날씨 때문에 감기 걸렸어요", "걷다"),
        ("목요일에 만나요", "목"),
        ("이마트에 다녀왔어요", "이마"),
        ("일본어를 배워요", "일"),
    ],
)
def test_substring_does_not_false_match(text, forbidden):
    """어휘 낱말을 **부분 문자열로 품은** 낱말에 걸리면 안 된다.

    형태소 경계를 지키는 덕에 막히는 것이지 문자열 비교로는 전부 걸린다 — 사용자
    사전 가중치를 올리면 여기부터 깨지므로 회귀 감시선으로 둔다.
    """
    items, _ = decompose(text)
    assert forbidden not in [ID_TO_ENTRY[w].label for _, w in items if w is not None]


def test_compound_verb_is_a_known_gap():
    """복합동사는 못 잡는다 — 분석기가 "걸어가" 를 한 동사로 보고, 그건 어휘에 없다.

    고치려면 복합동사를 성분으로 쪼개는 규칙이 필요한데 그건 이 모듈의 책임 범위를
    넘는다 (모듈 주석 「이 모듈의 책임은 여기까지다」). 알려진 한계로 고정해 둔다 —
    나중에 해결되면 이 테스트가 실패해서 알려준다.
    """
    items, _ = decompose("천천히 걸어가세요")
    assert all(word_id is None for _, word_id in items)


def test_unmatched_eojeol_is_reported_whole():
    """어절에서 아무것도 못 찾으면 어절 전체가 한 항목이다 — 어디서 막혔는지 가리키려고."""
    items, _ = decompose("컴퓨터를 샀어요")
    assert [text for text, word_id in items if word_id is None] == ["컴퓨터를", "샀어요"]


def test_unknown_word_keeps_position_among_playable_items(client):
    """재생 불가 항목도 빼지 않고 입력 순서 그대로 실린다 — 어디서 막혔는지가 핵심 정보다."""
    res = client.post(ENDPOINT, json=_body("밥 컴퓨터 부탁"))
    assert res.status_code == 200
    items = res.json()["items"]
    assert [item["source_text"] for item in items] == ["밥", "컴퓨터", "부탁"]
    assert [item["issue"] for item in items] == [None, "unknown_word", None]
    assert res.json()["playable"] is False


# ------------------------------------------------------------------ no_sequence
@pytest.fixture
def missing_sequence(monkeypatch) -> tuple[str, str]:
    """시퀀스가 없는 단어 상황을 **만들어서** 돌려준다 (label, id).

    sign-seq-v2 부터 어휘 300 이 전부 자산을 갖게 돼서 실제로 비어 있는 단어가
    없다. 그렇다고 no_sequence 테스트를 지우면, **어휘가 자산보다 먼저 늘어나는
    순간**(정상적인 작업 순서다) 이 경로가 아무도 모르게 깨진다. 그래서 매니페스트에서
    한 단어를 빼고 검사한다.
    """
    word_id = min(SEQUENCES)
    monkeypatch.delitem(SEQUENCES, word_id)
    return ID_TO_ENTRY[word_id].label, word_id


def test_no_sequence(client, missing_sequence):
    """어휘엔 있으나 아바타 시퀀스 자산이 없는 단어 → no_sequence.

    unknown_word 와 달리 word_id·label 은 채워지고 sequence_key 만 null 이다.
    "변환은 됐는데 재생할 게 없다" 를 그대로 드러내는 형태다.
    """
    label, word_id = missing_sequence
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


def test_unknown_word_and_no_sequence_are_distinguished(client, missing_sequence):
    """세 실패 상태가 한 응답 안에서 서로 다른 값으로 나와야 한다 — 이 API 의 존재 이유."""
    label, _ = missing_sequence
    playable = ID_TO_ENTRY[min(SEQUENCES)].label
    res = client.post(ENDPOINT, json=_body(f"{label} 컴퓨터 {playable}"))
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
