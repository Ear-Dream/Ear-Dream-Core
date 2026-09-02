# 선택 기능 — 문장 변환 LLM · 음성 합성

둘 다 별도 GPU 서버가 필요하고, **없어도 서비스는 동작합니다.**

| 기능 | 엔드포인트 | 서버가 없을 때 |
| --- | --- | --- |
| 문장 변환 LLM | `POST /api/v1/compose-sentence` | 규칙 템플릿 → 단어 나열로 폴백 (200 유지) |
| 음성 합성 (TTS) | `POST /api/v1/speech` | 503 → 앱이 브라우저 음성 합성으로 폴백 |

설정은 `packages/ear-dream-api/.env`에 둡니다 (`.env.example` 참고).

## 문장 변환 LLM

누적된 단어 열을 한국어 문장으로 바꿉니다. Qwen3-4B 2단계(문장 생성 → 감정·말투 분류)이며,
실패하면 규칙 템플릿으로 내려가고 사유를 서버 로그에 `llm_failed=`로 남깁니다.

| 기계 | 백엔드 | 설정 |
| --- | --- | --- |
| Windows / WSL + NVIDIA | vLLM (`:8001`) | `MODEL=Qwen/Qwen3-4B` |
| macOS | Ollama (`:11434`) | `MODEL=qwen3:4b` + `REASONING_EFFORT=none` + `STRUCTURED_OUTPUT=true` |

맥 프로필의 뒤 두 스위치는 한 세트입니다 — 하나라도 빠지면 매 요청 폴백합니다.

## 음성 합성 (TTS)

문장과 감정·말투 태그를 받아 WAV를 돌려줍니다. `compose-sentence` 응답의 태그를 그대로
넘기면 그 감정으로 읽습니다. Qwen3-TTS VoiceDesign을 vLLM-Omni로 서빙하며 **CUDA
전용이라 맥에서는 켤 수 없습니다** — 기본값이 꺼짐인 이유입니다.
