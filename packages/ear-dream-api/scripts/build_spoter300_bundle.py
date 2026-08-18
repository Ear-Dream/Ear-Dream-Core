"""SPOTER-208 300단어 서빙 산출물 빌드 — 벤치마크 레포 → 로컬 번들 + 어휘 데이터.

입력 (기본: 환경변수 EAR_DREAM_BENCHMARKS_DIR → ../Ear-Dream-Benchmarks →
       ~/Documents/Ear-Dream-Benchmarks 순으로 찾는다. --source 로 직접 지정):
    runs/pilot300_spoter_base_seed42_train/model_torchscript.pt   TorchScript 모델
    runs/pilot300_spoter_base_seed42_train/calibration.json       temperature + threshold sweep
    runs/pilot300_spoter_base_seed42_train/test_metrics.json      기록용 지표
    data/classes.json                                             WORDxxxx → class index
    일상_고빈도_핵심단어_300.csv                                    원본 단어 번호 → 한국어 단어

출력:
    var/models/spoter300-pilot/model_torchscript.pt    (복사 — var/ 는 .gitignore, 커밋 금지)
    var/models/spoter300-pilot/release.json            (기계 판독 핸드오프 — 로더의 정본)
    app/ml/data/vocab300.json                          (레포 커밋 대상 — 어휘 카탈로그 데이터)

vocab300.json 은 커밋하고 번들은 커밋하지 않는다 — /vocabulary 는 모델 파일 없이도
동작해야 하고(카탈로그는 부팅 시 로드), 모델 가중치는 레포에 넣지 않기 때문이다.
로더(app/ml/model.py)가 release.json class_labels 와 vocab300.json 을 교차 검증하므로
어긋난 조합은 로드 단계에서 거부된다.

사용:
    uv run python scripts/build_spoter300_bundle.py            # 기본 경로
    uv run python scripts/build_spoter300_bundle.py --source /path/to/sign_word_300
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

# 벤치마크 레포는 이 레포 밖에 있고 위치가 기계마다 다르다 — 절대경로를 박지 않는다.
# 환경변수 → 형제 디렉토리 → 홈 순으로 찾고, 어디에도 없으면 --source 로 넘긴다.
SOURCE_ENV = "EAR_DREAM_BENCHMARKS_DIR"  # Ear-Dream-Benchmarks 레포 루트
SOURCE_SUBDIR = "sign_word_300"
REPO_ROOT = API_ROOT.parents[1]


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


RUN_SUBDIR = "runs/pilot300_spoter_base_seed42_train"
WORDS_CSV = "일상_고빈도_핵심단어_300.csv"

BUNDLE_NAME = "spoter300-pilot"
FEATURE_VERSION = "spoter2_mp_xy_v1"
NUM_CLASSES = 300
# ⚠️ 임시값 — calibration.json threshold_sweep 의 0.5 지점 (val coverage 94.8% /
# kept acc 95.3%). 라이브 분포로 검증된 값이 아니다 (config.py 주석 참조).
RECOMMENDED_REJECT_THRESHOLD = 0.5
VOCAB_VERSION = "aihub300-pilot-v1-2026-08-11"


def build_class_labels(source: Path) -> list[dict]:
    """classes.json + CSV 로 class index → 어휘 항목을 만든다 (중복·결측 검증)."""
    classes: dict[str, int] = json.loads((source / "data/classes.json").read_text(encoding="utf-8"))
    if len(classes) != NUM_CLASSES:
        raise SystemExit(f"classes.json 항목 수 {len(classes)} != {NUM_CLASSES}")
    if sorted(classes.values()) != list(range(NUM_CLASSES)):
        raise SystemExit("classes.json 인덱스가 0..299 전단사가 아니다")

    # CSV 는 BOM 포함 (utf-8-sig). '원본 단어 번호' 가 WORDxxxx 의 xxxx 와 대응한다.
    with (source / WORDS_CSV).open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    num_to_word: dict[int, str] = {}
    for row in rows:
        num = int(row["원본 단어 번호"])
        if num in num_to_word:
            raise SystemExit(f"CSV 원본 단어 번호 중복: {num}")
        num_to_word[num] = row["단어"].strip()

    entries: list[dict | None] = [None] * NUM_CLASSES
    for word_key, index in classes.items():
        if not word_key.startswith("WORD"):
            raise SystemExit(f"classes.json 키 형식 불일치: {word_key!r}")
        num = int(word_key.removeprefix("WORD"))
        label = num_to_word.get(num)
        if label is None:
            raise SystemExit(f"CSV 에 {word_key} (번호 {num}) 의 단어가 없다")
        entries[index] = {
            "class_index": index,
            # 기존 어휘 ID 체계(w_{aihub 번호}) 유지 — 4자리 zero-pad (NIA_SL_WORDxxxx 와 동형)
            "id": f"w_{num:04d}",
            "label": label,
            "aihub_word_id": f"{num:04d}",
        }

    labels = [e["label"] for e in entries]  # type: ignore[index]
    if len(set(labels)) != NUM_CLASSES:
        dup = sorted({x for x in labels if labels.count(x) > 1})
        raise SystemExit(f"한국어 라벨 중복: {dup}")
    return entries  # type: ignore[return-value]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help=f"sign_word_300 경로 (기본: ${SOURCE_ENV} → 형제 → 홈 순으로 탐색)",
    )
    args = parser.parse_args()
    source: Path = (args.source or default_source()).expanduser()
    run = source / RUN_SUBDIR
    for required in (
        run / "model_torchscript.pt",
        run / "calibration.json",
        source / "data/classes.json",
        source / WORDS_CSV,
    ):
        if not required.exists():
            print(f"필수 입력이 없다: {required}", file=sys.stderr)
            return 1

    entries = build_class_labels(source)
    calibration = json.loads((run / "calibration.json").read_text(encoding="utf-8"))
    temperature = float(calibration["temperature"])
    test_metrics: dict = {}
    if (run / "test_metrics.json").exists():
        test_metrics = json.loads((run / "test_metrics.json").read_text(encoding="utf-8"))

    # ---- 어휘 데이터 (레포 커밋 대상)
    vocab_path = API_ROOT / "app/ml/data/vocab300.json"
    vocab_path.parent.mkdir(parents=True, exist_ok=True)
    vocab_path.write_text(
        json.dumps(
            {
                "vocab_version": VOCAB_VERSION,
                "source": {
                    "classes": str(Path("data/classes.json")),
                    "words_csv": WORDS_CSV,
                    "benchmark_dir": source.name,
                },
                "entries": entries,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )

    # ---- 번들 (var/ — 커밋 금지)
    bundle = API_ROOT / "var/models" / BUNDLE_NAME
    bundle.mkdir(parents=True, exist_ok=True)
    shutil.copy2(run / "model_torchscript.pt", bundle / "model_torchscript.pt")
    release = {
        "bundle": BUNDLE_NAME,
        "created_at": datetime.now(UTC).isoformat(),
        "feature_version": FEATURE_VERSION,
        "model_name": "spoter_208",
        "num_classes": NUM_CLASSES,
        "max_sequence_length": 256,
        "class_labels": [e["label"] for e in entries],
        "serving": {
            "artifact": "model_torchscript.pt",
            "temperature": temperature,
            "recommended_reject_threshold": RECOMMENDED_REJECT_THRESHOLD,
            "reject_threshold_basis": (
                "calibration.json threshold_sweep 0.5 지점 — val(actor 07/08) coverage "
                "94.8% / kept acc 95.3%. ⚠️ 임시값 (라이브 분포 미검증)"
            ),
        },
        "source": {
            # 빌드한 기계의 절대경로를 싣지 않는다 — release.json 은 릴리스로 공개되고,
            # 여기 필요한 정보는 "어느 학습 run 인가"뿐이라 run 이름이면 충분하다.
            "run_dir": RUN_SUBDIR,
            "validation_nll_before": calibration.get("validation_nll_before"),
            "validation_nll_after": calibration.get("validation_nll_after"),
            "test_metrics": {
                k: test_metrics.get(k)
                for k in ("micro_top1", "macro_top1", "top3", "top5", "macro_f1")
            },
        },
    }
    (bundle / "release.json").write_text(
        json.dumps(release, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"vocab data : {vocab_path}")
    print(f"bundle     : {bundle}")
    print(f"temperature: {temperature}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
