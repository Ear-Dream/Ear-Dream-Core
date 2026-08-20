"""Hybrid H1b 300단어 서빙 산출물 빌드 — 벤치마크 레포 one_hand_hybrid → 로컬 번들.

SPOTER-208 베이스라인(B0, `sign_word_300`)을 이어받은 H1b 모델을 서빙 번들로 만든다.
피처 계약(`spoter2_mp_xy_v1`, [T,208] = pose 50 + right 42 + left 42 + face 74)과
300 클래스 인덱스가 **베이스라인과 동일**하므로 전처리와 vocab300.json 은 건드리지
않는다 — 이 스크립트는 그 동일성을 **검증**하고 어긋나면 빌드를 거부한다.

입력 (기본: 환경변수 EAR_DREAM_BENCHMARKS_DIR → ../Ear-Dream-Benchmarks →
       ~/Documents/Ear-Dream-Benchmarks 순으로 찾는다. --source 로 직접 지정):
    runs/h1b_.../hybrid_model_torchscript.pt   TorchScript 모델 (4입력·4출력 — 아래)
    runs/h1b_.../h1_h2_test_metrics.json       REAL09 그룹별 지표 (기록용)
    runs/h1b_.../hybrid_export_parity.json     PyTorch/TorchScript 로짓 오차 (기록용)
    data/word_partition_report.json            label_index → 단어 (인덱스 검증용)

출력:
    var/models/hybrid300-h1b/model_torchscript.pt   (복사 — var/ 는 .gitignore, 커밋 금지)
    var/models/hybrid300-h1b/release.json           (기계 판독 핸드오프 — 로더의 정본)

**vocab300.json 은 쓰지 않는다.** 베이스라인 빌드(build_spoter300_bundle.py)가 만든
파일이 이미 정본이고, 여기서는 word_partition_report.json 의 label_index 순서 및
word_id 가 그 파일과 완전히 일치하는지만 확인한다. 불일치면 조용한 전량 오답이므로
빌드 자체를 중단한다.

⚠️ live_debias.npy 는 **복사하지 않는다.** 베이스라인 번들의 편향 벡터는 그 모델의
출력 분포로 추정한 값이라 다른 모델에 적용하면 보정이 아니라 새 편향 주입이 된다.
로더가 파일 부재를 α=0(항등)으로 폴백한다.

TorchScript 인터페이스가 베이스라인과 다르다 (release.json serving.interface="hybrid_v1"):
    forward(x[B,T,208], padding[B,T] bool, detected[B,T,2], view[B,T,2])
        -> (full_logits[B,300], onehand_logits[B,106], hand_type_logits[B,2], embedding[B,128])
서빙은 full_logits 만 쓰고 view 는 항상 FULL(1,1) 이다 — 근거는 app/ml/model 참조.

사용:
    uv run python scripts/build_hybrid300_bundle.py
    uv run python scripts/build_hybrid300_bundle.py --source /path/to/one_hand_hybrid
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

SOURCE_ENV = "EAR_DREAM_BENCHMARKS_DIR"  # Ear-Dream-Benchmarks 레포 루트
SOURCE_SUBDIR = "one_hand_hybrid"
REPO_ROOT = API_ROOT.parents[1]

RUN_SUBDIR = "runs/h1b_preserve_shared_hand_one106_retrieval300_train"
PARTITION_JSON = "data/word_partition_report.json"

BUNDLE_NAME = "hybrid300-h1b"
FEATURE_VERSION = "spoter2_mp_xy_v1"  # 베이스라인과 동일 — 전처리는 바뀌지 않았다
MODEL_NAME = "hybrid_208_h1b"
NUM_CLASSES = 300
MAX_SEQUENCE_LENGTH = 256  # config features.max_len — 모델 pos embedding 상한이다
SERVING_INTERFACE = "hybrid_v1"

# temperature scaling: **이 모델에는 분류 head 캘리브레이션 산출물이 없다.**
# one_hand_hybrid 의 hybrid_calibration.json 은 retrieval(코사인) 점수용 RIGHT/LEFT
# 임계이지 로짓 온도가 아니다. 없는 값을 지어내지 않고 항등(1.0)으로 서빙한다.
TEMPERATURE = 1.0
TEMPERATURE_BASIS = (
    "미캘리브레이션(항등). one_hand_hybrid 에는 분류 head 온도 산출물이 없다 — "
    "hybrid_calibration.json 은 retrieval 코사인 임계다. 라벨된 라이브 평가셋 확보 후 재피팅"
)

# ⚠️ 임시값이 아니라 **미설정**이다. 온도가 항등이고 편향 제거도 꺼진 상태라 confidence
# 분포가 베이스라인과 완전히 다르다 — 과거 임계(0.15/0.5)의 근거가 모두 무효다.
# 0.0 = 거부 없음. 라벨된 라이브 평가셋으로 정하기 전까지 조용히 거부하지 않는다.
RECOMMENDED_REJECT_THRESHOLD = 0.0
REJECT_THRESHOLD_BASIS = (
    "미설정(0.0 = 거부 없음). 이 모델은 온도 미캘리브레이션 + 편향 제거 꺼짐이라 "
    "confidence 분포가 베이스라인과 다르다 — 과거 임계(0.15·0.5)의 근거는 무효다. "
    "라벨된 라이브 평가셋 확보 후 temperature 와 함께 재피팅할 것"
)


def default_source() -> Path:
    """번들 입력 디렉토리 후보를 순서대로 찾는다 (없으면 첫 후보를 그대로 돌려준다)."""
    env = os.environ.get(SOURCE_ENV)
    if env:
        return Path(env).expanduser() / SOURCE_SUBDIR
    candidates = [
        REPO_ROOT.parent / "Ear-Dream-Benchmarks" / SOURCE_SUBDIR,
        Path.home() / "Documents/Ear-Dream-Benchmarks" / SOURCE_SUBDIR,
    ]
    return next((c for c in candidates if c.is_dir()), candidates[0])


def verify_classes(source: Path) -> list[str]:
    """word_partition_report.json 이 vocab300.json 과 같은 인덱스 체계인지 확인한다.

    여기가 어긋나면 로드는 통과하는데 전부 오답이 되므로 빌드 단계에서 막는다
    (로더의 class_labels 교차 검증과 같은 취지 — 한 단계 앞으로 당긴 것).
    """
    report = json.loads((source / PARTITION_JSON).read_text(encoding="utf-8"))
    classes = sorted(report["classes"], key=lambda c: int(c["label_index"]))
    if [int(c["label_index"]) for c in classes] != list(range(NUM_CLASSES)):
        raise SystemExit(f"{PARTITION_JSON} label_index 가 0..{NUM_CLASSES - 1} 전단사가 아니다")

    vocab = json.loads((API_ROOT / "app/ml/data/vocab300.json").read_text(encoding="utf-8"))
    entries = sorted(vocab["entries"], key=lambda e: int(e["class_index"]))
    if len(entries) != NUM_CLASSES:
        raise SystemExit(f"vocab300.json 항목 수 {len(entries)} != {NUM_CLASSES}")

    for cls, entry in zip(classes, entries, strict=True):
        if cls["word"] != entry["label"]:
            raise SystemExit(
                f"class_index={entry['class_index']} 라벨 불일치: "
                f"partition={cls['word']!r} vs vocab300={entry['label']!r} — "
                "학습 어휘 순서가 서빙 어휘와 다르다 (조용한 전량 오답)"
            )
        if str(int(cls["word_id"])) != str(int(entry["aihub_word_id"])):
            raise SystemExit(
                f"class_index={entry['class_index']} word_id 불일치: "
                f"partition={cls['word_id']} vs vocab300={entry['aihub_word_id']}"
            )
    return [c["word"] for c in classes]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help=f"one_hand_hybrid 경로 (기본: ${SOURCE_ENV} → 형제 → 홈 순으로 탐색)",
    )
    args = parser.parse_args()
    source: Path = (args.source or default_source()).expanduser()
    run = source / RUN_SUBDIR
    artifact = run / "hybrid_model_torchscript.pt"
    for required in (artifact, source / PARTITION_JSON):
        if not required.exists():
            print(f"필수 입력이 없다: {required}", file=sys.stderr)
            return 1

    class_labels = verify_classes(source)

    def read_optional(path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    test_metrics = read_optional(run / "h1_h2_test_metrics.json")
    parity = read_optional(run / "hybrid_export_parity.json")

    bundle = API_ROOT / "var/models" / BUNDLE_NAME
    bundle.mkdir(parents=True, exist_ok=True)
    shutil.copy2(artifact, bundle / "model_torchscript.pt")

    release = {
        "bundle": BUNDLE_NAME,
        "created_at": datetime.now(UTC).isoformat(),
        "feature_version": FEATURE_VERSION,
        "model_name": MODEL_NAME,
        "num_classes": NUM_CLASSES,
        "max_sequence_length": MAX_SEQUENCE_LENGTH,
        "class_labels": class_labels,
        "serving": {
            "artifact": "model_torchscript.pt",
            # 로더가 forward 호출 방식을 고르는 스위치 (app/ml/model). 이 필드가 없는
            # 번들은 베이스라인 인터페이스(spoter_v1)로 취급된다 — 구 번들 롤백 호환.
            "interface": SERVING_INTERFACE,
            # 서빙은 항상 FULL view 다 — right_only/left_only 는 "검출된 손을 일부러
            # 가리는" ablation 이라 라이브 입력에는 해당하지 않는다 (app/ml/model 참조).
            "view": "full",
            "temperature": TEMPERATURE,
            "temperature_basis": TEMPERATURE_BASIS,
            "recommended_reject_threshold": RECOMMENDED_REJECT_THRESHOLD,
            "reject_threshold_basis": REJECT_THRESHOLD_BASIS,
        },
        "source": {
            # 빌드 기계의 절대경로는 싣지 않는다 (release.json 은 릴리스로 공개된다).
            "project": SOURCE_SUBDIR,
            "run_dir": RUN_SUBDIR,
            "export_parity": parity,
            # REAL09 test — FULL view 그룹별 지표만 싣는다 (서빙이 쓰는 경로).
            # ⚠️ 스튜디오 촬영 기준이다. 라이브 기대치로 인용하지 말 것.
            "test_metrics_full_view": test_metrics.get("full"),
        },
    }
    (bundle / "release.json").write_text(
        json.dumps(release, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"bundle    : {bundle}")
    print(f"interface : {SERVING_INTERFACE} (view=full)")
    print(f"classes   : {NUM_CLASSES} — vocab300.json 과 라벨·word_id 일치 확인됨")
    return 0


if __name__ == "__main__":
    sys.exit(main())
