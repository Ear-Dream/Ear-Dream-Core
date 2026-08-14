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

    # ---- 모델 서빙 — SPOTER-208 300단어 (develop 실험 브랜치: v2 30단어에서 전환)
    # 번들 디렉토리 하나만 가리킨다 (release.json + model_torchscript.pt).
    # 상대경로는 api 패키지 루트 기준 (model.resolve_bundle_dir). var/ 는 .gitignore —
    # 모델 파일은 레포에 커밋하지 않는다. 번들 생성: scripts/build_spoter300_bundle.py.
    model_bundle_dir: str = "var/models/spoter300-pilot"

    # ⚠️ 아래 수치는 전부 **프로토타입용 임시값**이다. 사용자 검증·실측 후 확정한다.
    recognize_top_k: int = (
        4  # 후보 개수 N — 임시값, 실측 후 확정. 4는 후보 시트 2×2 그리드에 맞춘 값
    )
    # 최고 confidence(temperature 적용 후) 미달 시 rejected.
    # None = release.json serving.recommended_reject_threshold 채택 (spoter300-pilot 은
    # 0.5 — calibration.json threshold_sweep 의 val coverage 94.8% / kept acc 95.3% 지점).
    # ⚠️ 0.15 는 라이브 분포용 임시 오버라이드다 (2026-08-11). 번들 권장값 0.5 는 스튜디오
    # val 기준이라 라이브에서는 정답 top-1 조차 거의 전량 거부한다 (실측: live_eval 45클립
    # 통과 2건, "생각" 10회 세션에서 top-1 정답 7회 중 통과 1회 — conf 가 도메인 갭으로
    # 눌려 0.05~0.56 에 분포). 0.15 는 live_eval 임계 곡선의 통과분 top-4 극대점(68.2%)
    # 이지만 n=45·화자 2 명 위에서 고른 과적합 위험 값이다 — 증강 재학습 후 라벨된 라이브
    # 셋으로 temperature 와 함께 재피팅할 것 (모델 레포 _workspace/16 문서 참조).
    reject_threshold: float | None = 0.15
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
    # (도메인 이동이 만든 클래스 편향 — 실망·퇴원·요리사 과호출 — 의 평균 log-softmax).
    # ⚠️ 임시값 — bias 는 라벨 없는 실사용 아카이브로 추정한 값이다. 2026-08-12 누수 차단
    # 재추정본(495건 — 라벨된 평가 세그먼트 41건 제외, 제외 목록은 재추정 시 재사용):
    # '희망' 자석 클래스 흡수(억제 13→5위), α=1.25 가 채택 규칙 통과(phone41 top-1
    # +2.4%p·live 무악화·REAL09 게이트 −0.07%p). EM 계열 prior 보정은 실측 파국으로
    # 기각됐다(아카이브의 "실사용 시도 단어"를 편향으로 오인 — 기간/누수 분리는 필수).
    # 재추정 절차: 신규 아카이브로 추정 → 라벨 평가셋(live_eval + phone_sessions)으로
    # 검증 → live_debias.npy 교체와 이 값을 함께 갱신.
    # 0.0 이면 완전 항등(제거 끔). 파일 부재 시 로더가 α=0 으로 폴백한다 (경고 1회).
    debias_alpha: float = 1.25

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
