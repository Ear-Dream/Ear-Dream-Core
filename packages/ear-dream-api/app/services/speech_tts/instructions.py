"""감정·말투 → 한국어 음성 instruction.

`Ear-Dream-TTS` 레포 `app/tts/instructions.py` 의 이식본이다. **문구를 임의로 고치지
말 것** — 문장 LLM 프롬프트와 같은 취지다(원본과 한 벌, 고치면 양쪽 동시에 +
`TTS_INSTRUCTION_VERSION` 갱신).

말투 표는 원본 그대로 7종이다. 이 레포의 문장 LLM 이 내는 `SentenceStyle` 은 그중
4종(normal/polite/casual/formal)이라 나머지 3종(excited/calm/serious)은 현재 호출되지
않는다 — 원본을 깎지 않고 남겨 둔 건, 태그 분류를 넓힐 때 여기가 이미 준비돼 있게
하기 위해서다.
"""

from __future__ import annotations

_EMOTION = {
    "neutral": "감정을 과장하지 말고 중간 음높이, 일정한 속도와 음량으로 자연스럽게 말하세요",
    "happy": "기쁜 소식을 전하듯 음높이와 에너지를 높이고, 억양을 크게 변화시키며 문장 끝을 밝게 올리세요",
    "sad": "슬픔을 억누르듯 낮은 음높이와 작은 음량으로 천천히 말하고, 끝음을 내려 주세요",
    "angry": "화를 단호하게 표현하듯 큰 음량과 끊어지는 리듬으로, 자음을 강하게 발음하세요",
    "surprised": "갑자기 놀란 듯 첫 단어를 강조하고, 음높이를 빠르게 올리며 억양 변화 폭을 크게 하세요",
    "fearful": "두려운 듯 긴장된 목소리로, 짧은 휴지와 불규칙한 속도, 약한 떨림을 표현하세요",
}

_STYLE = {
    "normal": "자연스러운 기본 말투를 사용하세요",
    "excited": "생동감과 리듬 변화를 분명하게 표현하세요",
    "calm": "호흡을 안정시키고 서두르지 마세요",
    "serious": "장난스럽지 않게 또렷하고 무게감 있게 말하세요",
    "polite": "정중하고 예의 바른 높임말 억양을 사용하세요",
    "casual": "친한 사람에게 말하듯 편안한 일상 말투를 사용하세요",
    "formal": "공식 발표처럼 격식을 갖추고 명확하게 말하세요",
}


def build_tts_instruction(emotion: str, style: str) -> str:
    """안정적인 API 라벨을 자연어 음성 지시문으로 바꾼다."""
    try:
        return f"{_EMOTION[emotion]}. {_STYLE[style]}"
    except KeyError as exc:
        raise ValueError(f"unsupported emotion/style: {emotion}/{style}") from exc
