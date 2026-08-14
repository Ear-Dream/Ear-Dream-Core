"""TTS 런타임 프로필 — 실험으로 확정된 값.

`Ear-Dream-TTS` 레포 `app/tts/profile.py` 의 이식본이다. 원본이 상수로 못 박아 둔
이유는 문장 LLM 과 같다 — instruction 문구와 음질 평가가 이 모델 위에서 나왔다.
"""

MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
TASK_TYPE = "VoiceDesign"
LANGUAGE = "Korean"

# instruction 문구가 바뀌면 올린다 (프롬프트 판본과 같은 취지).
TTS_INSTRUCTION_VERSION = "eardream-tts-voicedesign-2026-08-14"
