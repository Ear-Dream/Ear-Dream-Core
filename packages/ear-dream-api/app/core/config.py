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
    # ⚠️ 임시값 — bias 는 **라벨 없는 실사용 아카이브 405건**으로 추정한 값이다:
    #   (a) 기간 분리 재추정 필요 — 아카이브가 쌓이면 추정 기간과 평가 기간을 분리할 것
    #   (b) live_eval 15.6→26.7%(조합 31.1%)의 평가셋과 아카이브의 도메인이 겹쳐
    #       낙관 편향 가능성이 있다 — 라벨된 라이브 셋 확보 후 재검증
    # 0.0 이면 완전 항등(제거 끔). 파일 부재 시 로더가 α=0 으로 폴백한다 (경고 1회).
    debias_alpha: float = 1.0

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
