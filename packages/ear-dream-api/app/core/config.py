from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# api 패키지 루트 (packages/ear-dream-api)
PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # model_bundle_dir 가 pydantic 의 "model_" 보호 접두와 겹치므로 해제한다
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="EAR_DREAM_", protected_namespaces=()
    )

    app_name: str = "Ear Dream API"
    api_v1_prefix: str = "/api/v1"
    cors_allow_origins: list[str] = ["*"]

    # ear_dream 네임스페이스 로거 레벨 (app/core/logging.py). 요청 처리 로그는 INFO.
    log_level: str = "INFO"

    # ---- 모델 서빙 — Single-Observed-Hand 208D 300단어 (single_observed_hand_300)
    # 번들 디렉토리 하나만 가리킨다 (release.json + model_torchscript.pt).
    # 상대경로는 api 패키지 루트 기준 (model.resolve_bundle_dir). var/ 는 .gitignore —
    # 모델 파일은 레포에 커밋하지 않는다. 번들 생성: scripts/build_single_observed_bundle.py.
    # 전처리 계약(spoter2_mp_xy_v1)과 300 클래스 인덱스가 세 세대 모두 같으므로 이 값만
    # 바꾸면 모델이 갈린다 — forward 호출 규약은 번들의 serving.interface 가 밝힌다:
    #   var/models/single-observed-300-allpeople   현재 (single_observed_v1)
    #   var/models/single-observed-300             같은 세대, 3인 v1 만 학습 (calibration 있음)
    #   var/models/hybrid300-h1b                   Hybrid H1b (hybrid_v1)
    #   var/models/spoter300-pilot                 SPOTER-208 베이스라인 (spoter_v1)
    # ⚠️ spoter300-pilot 으로 롤백할 때는 reject_threshold 0.15 · debias_alpha 1.25 도
    # 함께 되돌릴 것 (아래 주석). 나머지 번들은 release.json 권장값이 맞다.
    model_bundle_dir: str = "var/models/single-observed-300-allpeople"

    # ⚠️ 아래 수치는 전부 **프로토타입용 임시값**이다. 사용자 검증·실측 후 확정한다.
    recognize_top_k: int = (
        4  # 후보 개수 N — 임시값, 실측 후 확정. 4는 후보 시트 2×2 그리드에 맞춘 값
    )
    # 최고 confidence(temperature 적용 후) 미달 시 rejected.
    # None = release.json serving.recommended_reject_threshold 채택.
    # ⚠️ **hybrid300-h1b 에는 이 임계의 근거가 없다.** 이 모델은 temperature 가
    # 미캘리브레이션(1.0 항등)이고 편향 제거도 꺼져 있어 confidence 분포가 베이스라인과
    # 다르다 — 과거 오버라이드 0.15(SPOTER-208 의 편향 제거 후 분포에 live_eval n=45 로
    # 피팅한 값)와 번들 권장 0.5(스튜디오 val 기준)는 **둘 다 이 모델에 적용되지 않는다**.
    # 그래서 None 으로 두고 번들 권장값(0.0 = 거부 없음)을 따른다: 근거 없는 임계로
    # 조용히 거부하느니 전부 후보를 내보내고, 라벨된 라이브 평가셋 확보 후
    # temperature 와 함께 재피팅한다.
    # spoter300-pilot 으로 롤백할 때는 0.15 로 되돌릴 것 (git log 에 근거 주석이 있다).
    reject_threshold: float | None = None
    # ---- 라이브 도메인 갭 개입 2종 (2026-08-11 실측 검증 — 모델 레포
    # _workspace/17_hypothesis_ledger.md. 수식 정본은 scripts/live_eval.py 러너였고
    # 지금은 서빙 코드가 정본이다: y 는 preprocess_spoter, 편향 제거는 app/ml/model)
    #
    # y축 기하 보정 배율 — **전 부위** 원시 y 에 정규화 이전 곱한다 (AR x 보정과 같은
    # 지점). 셀피 원근으로 어깨 대비 몸통이 짧게 잡히는 갭(스튜디오 어깨-엉덩이 y비
    # 1.94 vs 라이브 1.61 ≈ ×1.205)의 사영 보정.
    # ⚠️ 임시값 — live_eval(n=45) top-1 15.6→22.2%, 배율 1.2~1.3 이 고원이라 점 추정
    # 과적합은 아니다. 스튜디오 회귀는 REAL09 1500클립 97.5/99.9 (베이스라인 98.3/100,
    # −0.8%p) 로 허용 범위 — 단 AR 보정과 달리 **고정 상수라 스튜디오 입력에도 항등이
    # 아니다**. 증강 재학습 후 재검토할 것. 1.0 이면 완전 항등(보정 끔).
    live_y_scale: float = 1.205
    # 로짓 편향 제거 강도 α — log_softmax(logits/T) 에서 α·(bias − bias.mean()) 을 뺀 뒤
    # softmax 재정규화 (app/ml/model.predict_probs). bias 는 번들의 live_debias.npy
    # (도메인 이동이 만든 클래스 편향의 평균 log-softmax).
    # ⚠️ **편향 벡터는 모델별이다 — 그래서 현재 기본값이 0.0(끔)이다.** 기존 값 1.25 는
    # SPOTER-208(spoter300-pilot)의 출력 분포로 추정한 live_debias.npy 위에서 고른
    # 값이라, 가중치가 바뀐 hybrid300-h1b 에 그대로 적용하면 보정이 아니라 **새 편향
    # 주입**이 된다. hybrid300-h1b 번들에는 편향 파일 자체가 없으므로 로더도 α=0 으로
    # 폴백하지만, 설정 기본값까지 0.0 으로 내려 두 곳이 어긋나지 않게 한다.
    # spoter300-pilot 으로 롤백할 때는 1.25 로 되돌릴 것 — 그 값의 근거(2026-08-12
    # 누수 차단 재추정 495건, phone41 top-1 +2.4%p, REAL09 게이트 −0.07%p, EM 계열
    # prior 보정 기각)는 git log 의 이전 주석에 남아 있다.
    # 재추정 절차: 신규 아카이브로 추정 → 라벨 평가셋으로 검증 → live_debias.npy 교체와
    # 이 값을 함께 갱신. 0.0 이면 완전 항등(제거 끔).
    debias_alpha: float = 0.0

    # 세그먼트 프레임 수 범위 — 요청(Pydantic) 검증용. SPOTER 전처리는 trim 없이 전
    # 구간을 쓰고 30fps 리샘플 후 256 초과분은 uniform sampling 으로 흡수하므로
    # max_frames 는 모델 상한이 아니라 페이로드 상한이다. 둘 다 임시값, 실측 후 확정.
    min_frames: int = 8
    max_frames: int = 300

    # 포즈 landmark visibility 임계 — kp130 조립(품질 판정·진단)의 결측(NaN) 마스킹용.
    # SPOTER 전처리의 pose 25점은 visibility 를 보지 않는다 (학습 추출기 Holistic 과 동일).
    # 임시값, 실측 후 확정
    pose_visibility_threshold: float = 0.5

    # 허용하는 얼굴 메쉬 점 개수. SPOTER-208 의 face 37 인덱스는 홍채(468·473)를 포함하므로
    # **478점(refine landmarks) 메쉬가 필수**다 — 468점 페이로드는 422 로 명확히 거절한다.
    # (대안이던 "468 수신 시 얼굴 미검출로 강등"은 원인(프론트 모델 구성 변경)을 조용히
    # 감춰 정확도만 떨어뜨리므로 채택하지 않았다. 라이브 아카이브 실측상 실세션은 전부
    # 478점을 보낸다 — 468은 합성 테스트 페이로드뿐이었다.)
    face_point_counts: list[int] = [478]

    # ---- 문장 변환 LLM (Ear-Dream-Gloss2Sentence 이식 — app/services/sentence_llm)
    # 단어열 → 문장 변환을 규칙 템플릿 대신 Qwen3-4B(vLLM)로 한다. vLLM 서버는 이 레포
    # 밖에서 돌고(원본 README: WSL2 + RTX 4090), **없어도 서비스는 동작한다** —
    # 실패하면 라우트가 기존 규칙(template → word_list)으로 폴백한다.
    #
    # **개발 기계에 따라 백엔드가 갈린다** (README 「단어열 → 문장 변환」):
    #   - Windows/WSL + NVIDIA GPU: vLLM (`:8001/v1`, `Qwen/Qwen3-4B` BF16) — 검증 환경
    #   - macOS: Ollama (`:11434/v1`, `qwen3:4b`) — vLLM 이 CUDA 전용이라 맥에서 안 돈다
    # 둘 다 OpenAI 호환 `/chat/completions` 라 클라이언트는 하나로 충분하고, 갈리는 건
    # base_url 과 모델 ID 두 개뿐이다.
    #
    # ⚠️ 모델 ID 를 설정으로 연 것은 이 분기 때문이다. 원본 레포는 상수로 못 박아 뒀고
    # 그 취지(프롬프트·평가 수치가 Qwen3-4B BF16 위에서 나온 값이라 **조용히** 갈리면
    # 안 된다)는 유효하다 — 그래서 기본값을 검증 모델로 두고, 실제 사용한 모델을 응답
    # `llm_model` 과 서버 로그에 항상 싣는다. 다른 모델을 넣는 순간 원본의 평가 수치
    # (2단계 표적 10/10 등)는 그 설정에 적용되지 않는다.
    sentence_llm_enabled: bool = True
    sentence_llm_model: str = "Qwen/Qwen3-4B"
    sentence_llm_base_url: str = "http://localhost:8001/v1"
    sentence_llm_api_key: str = "dummy"  # vLLM 은 검사하지 않지만 헤더 형식상 필요
    # ⚠️ 임시값 — 2단계(문장+태그) 실측 latency 가 아직 이 레포에 없다. 프론트 상한이
    # 15s(RECOGNIZE_TIMEOUT_MS)라 그보다 먼저 끊어져 폴백이 돌게 잡았다.
    sentence_llm_timeout_seconds: float = 10.0
    sentence_llm_temperature: float = 0.0  # 원본 고정값 — 문장은 결정적이어야 한다
    sentence_llm_max_tokens: int = 256  # 원본 고정값
    # OpenAI 표준 `reasoning_effort`. 값이 있을 때만 요청에 실린다 (기본 None = 미전송).
    # **Ollama + qwen3 계열에서는 "none" 이 필수다.** qwen3 는 thinking 모델이고 Ollama 의
    # OpenAI 호환 경로는 vLLM 이 쓰는 `chat_template_kwargs.enable_thinking` 를 조용히
    # 무시한다 — 실측(2026-08-14): 끄지 못하면 추론이 max_tokens 를 다 먹어 응답이 빈
    # 문자열로 잘리고(finish_reason=length) 46초까지 걸린다. "none" 을 주면 0.5초에
    # 정상 JSON 이 나온다. vLLM 쪽은 기본 None 이라 페이로드가 그대로다.
    sentence_llm_reasoning_effort: str | None = None
    # 출력 형식 강제. false = `response_format: json_object` (원본 방식 — 스키마는
    # 프롬프트 문장으로만 지시), true = `json_schema` 로 출력 계약 자체를 제약한다.
    # 스키마는 GeneratedSentence/GeneratedTags 에서 파생되므로 프롬프트는 손대지 않는다.
    #
    # **thinking 을 끈 qwen3:4b 에서는 true 가 필수다** (2026-08-14 실측). 끄면 모델이
    # 프롬프트의 번호 규칙을 출력 필드로 흉내내거나(1단계 `step1`/`step2`), 2단계에서
    # 분류 대신 입력을 그대로 되돌려준다 — json_object 로는 못 막고 매 요청 폴백한다.
    # true 로 두면 1·2단계 4/4 통과, 원본 표적 예시 6/6 일치(부정 함정 포함).
    # 기본 false: 원본 평가가 json_object 위에서 이뤄졌으므로 vLLM 프로필은 그대로 둔다.
    sentence_llm_structured_output: bool = False
    # 감정·말투 2단계 분류. 끄면 요청당 추론이 1회로 줄지만 emotion/style 이 기본값이 된다.
    sentence_llm_tags_enabled: bool = True

    # ---- 문장 → 음성 TTS (Ear-Dream-TTS 이식 — app/services/speech_tts)
    # Qwen3-TTS VoiceDesign 을 vLLM-Omni 로 서빙한다. 문장 LLM 과 같은 구조지만
    # **폴백 위치가 다르다**: 서버에는 대체 음성 수단이 없어 503 을 내고, 앱이 브라우저
    # 음성 합성으로 내려간다. 그래서 이게 꺼져 있어도 소리는 계속 나온다.
    # vLLM-Omni 는 CUDA 전용이라 맥에서 안 돈다 — 맥 개발 기본값은 꺼짐이다.
    # ⚠️ 기본 false 인 이유: 켜 두면 재생마다 연결 실패를 기다렸다가 폴백하므로 첫
    # 소리가 그만큼 늦어진다. 문장 LLM(폴백이 서버 안에서 즉시 끝남)과 다른 점이다.
    tts_enabled: bool = False
    tts_base_url: str = "http://localhost:8091"  # vLLM-Omni 직접 (원본의 중간 FastAPI 흡수)
    # 원본 확정 프로필. speech_tts.profile.MODEL 과 같은 값이어야 하며(순환 import 를
    # 피하려고 리터럴로 둔다) 어긋나면 test_speech.py 가 잡는다.
    tts_model: str = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
    tts_voice: str = "sohee"  # CustomVoice 호환용. VoiceDesign 은 preset voice 를 안 쓴다
    # ⚠️ 원본 기본값은 300s 다(모델 로딩 포함 상정). 여기서는 사용자가 재생 버튼을 누르고
    # 기다리는 시간이라 짧게 잡았다 — 초과하면 앱이 브라우저 음성으로 폴백한다.
    # 원본 README 실측 예시가 6.1s 라 그 2배 남짓. 실기기 실측 후 확정한다.
    tts_timeout_seconds: float = 15.0
    # instruction 요청이 실패하면 텍스트만으로 재시도한다(감정은 빠지고 소리는 나온다).
    tts_text_only_fallback: bool = True

    # ---- 응답 압축 (app/core/compression.py)
    # 실측: /vocabulary 54KB → 5KB. 나머지 응답은 수백 바이트라 상한 아래로 떨어진다.
    # /speech 의 WAV 는 경로로 제외한다 — 이득이 적고 첫 소리가 늦어진다.
    response_gzip_min_bytes: int = 1024

    # ---- 요청 크기 상한 (app/core/limits.py · app/core/compression.py)
    # 공개 URL(터널)로 열면 인증 없는 /recognize 가 그대로 노출된다. 라우트가 검증
    # 이전에 raw body 를 통째로 버퍼링해 아카이빙하므로 그 앞에서 끊어야 한다.
    # ⚠️ 임시값 — 실측 최대 페이로드가 6.29MB(98프레임 3.47MB)이고 max_frames=300 이면
    # 12MB 안팎이라, 여유를 두되 자릿수는 넘지 않게 잡았다. 실사용 분포로 재조정한다.
    max_request_bytes: int = 32 * 1024 * 1024  # 전선 위 바이트 (압축 여부 무관)
    max_decompressed_bytes: int = 48 * 1024 * 1024  # gzip 해제 후 (증폭 방어)

    # ---- /recognize 요청 아카이빙 (데이터셋 수집용)
    archive_enabled: bool = True
    archive_dir: str = "var/archive"  # api 패키지 루트 기준

    # ---- /recognize 진단 로깅 (모델 오답 분석용 — app/services/diagnostics.py)
    # ⚠️ 기본 on 은 개발 단계 임시값이다. 운영 정책(보존 기간·용량)이 정해지면 재검토한다.
    diagnostics_enabled: bool = True
    diagnostics_dir: str = "var/diagnostics"  # api 패키지 루트 기준

    @property
    def package_root(self) -> Path:
        return PACKAGE_ROOT


settings = Settings()
