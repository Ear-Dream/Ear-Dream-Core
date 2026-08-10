from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# api 패키지 루트 (packages/ear-dream-api)
PACKAGE_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # model_checkpoint_path 가 pydantic 의 "model_" 보호 접두와 겹치므로 해제한다
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="EAR_DREAM_", protected_namespaces=()
    )

    app_name: str = "Ear Dream API"
    api_v1_prefix: str = "/api/v1"
    cors_allow_origins: list[str] = ["*"]

    # ear_dream 네임스페이스 로거 레벨 (app/core/logging.py). 요청 처리 로그는 INFO.
    log_level: str = "INFO"

    # ---- 모델 서빙
    # 상대경로는 api 패키지 루트 기준으로 해석한다 (model.resolve_checkpoint_path).
    # 체크포인트 파일은 레포에 복사·커밋하지 않는다 — 경로 참조만.
    # v2 z-off (전처리 등방 정규화 + z 채널 0 고정 재학습, 핸드오프 09_z_gap_response.md §2)
    # — tasks-vision pose z 분포 비호환에 구조적으로 면역이면서 스튜디오 회귀 없음.
    model_checkpoint_path: str = (
        "../../../Ear-Dream-Model/experiments/runs/exp15_small_v2_z-off_f4/best.pt"
    )
    # temperature scaling 산출물 — 하드코딩 대신 파일 참조 (없으면 1.0 + 경고 로그)
    model_calibration_path: str = "../../../Ear-Dream-Model/experiments/calibration.json"

    # ⚠️ 아래 수치는 전부 **프로토타입용 임시값**이다. 사용자 검증·실측 후 확정한다.
    recognize_top_k: int = 3  # 후보 개수 N — 임시값, 실측 후 확정
    # 최고 confidence(캘리브레이션 후) 미달 시 rejected. 0.45 = z-off(exp15) 캘리브레이션
    # (T=0.6024) 후 결합 스트레스(최악 조건 대리) 스윕의 coverage 87.8% / kept acc 86.1%
    # 균형점 (핸드오프 09_z_gap_response.md §2, calibration.json 권장값).
    # ⚠️ 여전히 임시값이다 — 라벨된 실사용 아카이브가 모이면 재조정할 것.
    reject_threshold: float = 0.45
    min_frames: int = 8  # 세그먼트 최소 프레임 수 — 임시값 (전처리 MIN_TRIM_LEN 과 동일값)
    max_frames: int = 300  # 세그먼트 최대 프레임 수 — 임시값, 실측 후 확정

    # 포즈 landmark visibility 임계 — 미달 점은 결측(NaN) 처리. 임시값, 실측 후 확정
    pose_visibility_threshold: float = 0.5

    # 허용하는 얼굴 메쉬 점 개수 (MediaPipe 모델 구성에 따라 468 또는 478)
    face_point_counts: list[int] = [468, 478]

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
