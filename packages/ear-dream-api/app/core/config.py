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
    # ⚠️ 0.5 는 임시 채택값이다 — val 은 스튜디오 데이터라 라이브 분포로 검증되지 않았다.
    # 라벨된 실사용 아카이브가 모이면 재조정할 것. 수동 오버라이드가 필요할 때만 float.
    reject_threshold: float | None = None
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
