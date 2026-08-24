"""Single-Observed-Hand 300단어 서빙 번들 빌드 — 학습 레포에서 **원격으로** 받아 만든다.

기본 입력은 GitHub 의 Ear-Dream-Benchmarks 다. 학습 레포를 클론해 둘 필요가 없고,
어느 기계에서 돌려도 같은 산출물이 나온다 — 참조를 **커밋 SHA 로 고정**하기 때문이다.
(이전 세대 스크립트들은 "학습 레포가 형제 디렉토리에 있다"를 전제했는데, 이 레포는
공개 저장소라 그 전제가 맞지 않았다. 이 스크립트가 새 기준이다.)

전처리 계약(`spoter2_mp_xy_v1`, [T,208])과 300 클래스 인덱스는 이전 세대와 같으므로
`preprocess_spoter.py` 와 `vocab300.json` 은 건드리지 않는다.

⚠️ **클래스 인덱스 대조 파일이 학습 레포에 올라와 있지 않다.** 정본은
`data/organized300_v1/word_partition_report.json` 인데 그쪽 .gitignore 대상이다.
올라오면 `--partition`(경로 또는 URL)으로 넘겨 자동 대조하게 해 두었다. 넘기지 않으면
대조 없이 빌드하므로, 인덱스가 검증된 산출물인지 스스로 확인해야 한다.
확인 방법: 라벨된 REAL09 로 채점 — 순서가 맞으면 ~89%, 어긋나면 ~0.3%(우연)라 판정이
명확하다. 2026-08-24 두 번들 모두 88.9~89.0% 로 일치 확인.

출력: var/models/{bundle}/{model_torchscript.pt, release.json}  (var/ 는 .gitignore)

번들 후보가 둘이다 (--run 으로 고른다):
    final_all_people_deployment  3인 v1+v2 전부 학습. calibration 없음 (기본 — 라벨된
                                 라이브 셋 실측에서 임계 전 구간 우세)
    final_deployment             3인 v1 만 학습, v2 홀드아웃. calibration 있음

⚠️ live_debias.npy 는 만들지 않는다 — 편향 벡터는 모델별이라 다른 가중치에 쓰면
보정이 아니라 새 편향 주입이 된다. 로더가 부재를 α=0(항등)으로 폴백한다.

사용:
    uv run python scripts/build_single_observed_bundle.py
    uv run python scripts/build_single_observed_bundle.py --run final_deployment
    uv run python scripts/build_single_observed_bundle.py --ref main        # 최신으로
    uv run python scripts/build_single_observed_bundle.py --source /path/to/checkout
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]

# 학습 레포 (public). ref 를 커밋 SHA 로 고정해 재현성을 지킨다 — 브랜치로 두면
# 같은 명령이 시점에 따라 다른 가중치를 받는다. 새 모델을 받을 때 SHA 를 갱신한다.
REPO = "Ear-Dream/Ear-Dream-Benchmarks"
DEFAULT_REF = (
    "8b05d02ba4249bef1a8a2ffb37c7d7c63b18e1a6"  # "Add single observed hand 300-word model"
)
PROJECT = "single_observed_hand_300"
RAW_BASE = "https://raw.githubusercontent.com"

FEATURE_VERSION = "spoter2_mp_xy_v1"  # 이전 세대와 동일 — 전처리는 바뀌지 않았다
MODEL_NAME = "single_observed_hand_208"
NUM_CLASSES = 300
MAX_SEQUENCE_LENGTH = 256
SERVING_INTERFACE = "single_observed_v1"
ARTIFACT_NAME = "single_observed_hand_model.pt"

# temperature: 학습 레포에 로짓 온도 산출물이 없다. calibration.json 은 softmax 확률
# 위의 **임계**이지 온도가 아니므로, 온도는 항등(1.0)으로 두고 임계만 채택한다.
TEMPERATURE = 1.0
TEMPERATURE_BASIS = (
    "미캘리브레이션(항등). 학습 레포에 로짓 온도 산출물이 없다 — calibration.json 은 "
    "softmax 확률 위의 reject 임계이지 온도가 아니다"
)

RUNS = {
    "final_all_people_deployment": (
        "single-observed-300-allpeople",
        (
            "3인(st/hy/hs) v1+v2 전부 학습. 홀드아웃이 없어 calibration 과 학습 레포측 "
            "일반화 실측이 둘 다 없다 (자체 보고 99.33% 는 학습·평가가 겹친 값이라 인용 금지). "
            "다만 Core 의 라벨된 라이브 셋(138클립, 미겹침 사용자)에서 top-1 29.0% / "
            "top-4 54.3% 로 final_deployment(28.3 / 48.6)보다 임계 전 구간 우세"
        ),
    ),
    "final_deployment": (
        "single-observed-300",
        (
            "3인 v1 로 person-adapted, v2 전량 홀드아웃. 홀드아웃 실측: st v2 top-1 87.33%, "
            "hy/hs v2 무조건부 74.17%. calibration 있음"
        ),
    ),
}


def fetch(url: str, timeout: float = 120.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "ear-dream-bundle-build"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise SystemExit(
            f"다운로드 실패 (HTTP {exc.code}): {url}\n"
            "ref/경로가 맞는지, 레포가 공개인지 확인할 것. 로컬 체크아웃이 있으면 "
            "--source 로 그 경로를 넘길 수 있다."
        ) from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"네트워크 오류: {url}\n{exc.reason}") from exc


class Source:
    """원격(GitHub raw) 또는 로컬 체크아웃에서 파일을 읽는 공통 인터페이스."""

    def __init__(self, ref: str, local: Path | None) -> None:
        self.ref = ref
        self.local = local

    def describe(self) -> str:
        return str(self.local) if self.local else f"{REPO}@{self.ref[:12]}"

    def url_for(self, rel: str) -> str:
        return f"{RAW_BASE}/{REPO}/{self.ref}/{PROJECT}/{rel}"

    def read(self, rel: str) -> bytes | None:
        """없으면 None. 필수 파일은 호출부에서 판정한다."""
        if self.local is not None:
            path = self.local / rel
            return path.read_bytes() if path.is_file() else None
        try:
            return fetch(self.url_for(rel))
        except SystemExit:
            return None

    def read_required(self, rel: str) -> bytes:
        data = self.read(rel)
        if data is None:
            location = (self.local / rel) if self.local else self.url_for(rel)
            raise SystemExit(f"필수 입력이 없다: {location}")
        return data

    def read_json(self, rel: str) -> dict:
        data = self.read(rel)
        return json.loads(data.decode("utf-8")) if data else {}


def vocab_labels() -> list[str]:
    vocab = json.loads((API_ROOT / "app/ml/data/vocab300.json").read_text(encoding="utf-8"))
    entries = sorted(vocab["entries"], key=lambda e: int(e["class_index"]))
    if len(entries) != NUM_CLASSES:
        raise SystemExit(f"vocab300.json 항목 수 {len(entries)} != {NUM_CLASSES}")
    return [e["label"] for e in entries]


def verify_partition(raw: bytes, labels: list[str], origin: str) -> None:
    """학습 쪽 partition 이 주어지면 vocab300 순서와 대조한다 (조용한 전량 오답 방지)."""
    report = json.loads(raw.decode("utf-8"))
    classes = sorted(report["classes"], key=lambda c: int(c["label_index"]))
    if [int(c["label_index"]) for c in classes] != list(range(NUM_CLASSES)):
        raise SystemExit(f"{origin} label_index 가 0..{NUM_CLASSES - 1} 전단사가 아니다")
    for cls, label in zip(classes, labels, strict=True):
        if cls["word"] != label:
            raise SystemExit(
                f"class_index={cls['label_index']} 라벨 불일치: "
                f"partition={cls['word']!r} vs vocab300={label!r} — 조용한 전량 오답"
            )
    print(f"인덱스 대조 통과: {origin}")


def load_partition(spec: str, source: Source) -> tuple[bytes, str]:
    if spec.startswith(("http://", "https://")):
        return fetch(spec), spec
    path = Path(spec)
    if path.is_file():
        return path.read_bytes(), str(path)
    data = source.read(spec)  # 프로젝트 루트 기준 상대경로로도 받는다
    if data is None:
        raise SystemExit(f"--partition 을 찾을 수 없다: {spec}")
    return data, spec


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", choices=sorted(RUNS), default="final_all_people_deployment")
    parser.add_argument("--ref", default=DEFAULT_REF, help="커밋 SHA/브랜치/태그 (기본: 고정 SHA)")
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help=f"로컬 {PROJECT} 체크아웃 경로 (원격 대신 여기서 읽는다)",
    )
    parser.add_argument(
        "--partition",
        default=None,
        help="word_partition_report.json — 경로/URL/프로젝트 상대경로. 있으면 인덱스 대조",
    )
    args = parser.parse_args()

    source = Source(args.ref, args.source.expanduser() if args.source else None)
    print(f"source    : {source.describe()}")

    labels = vocab_labels()
    if args.partition:
        raw, origin = load_partition(args.partition, source)
        verify_partition(raw, labels, origin)
    else:
        print("⚠️ --partition 미지정 — 클래스 인덱스 대조 없이 빌드한다 (docstring 참조)")

    run_rel = f"runs/{args.run}"
    print(f"다운로드  : {run_rel}/{ARTIFACT_NAME}", flush=True)
    artifact = source.read_required(f"{run_rel}/{ARTIFACT_NAME}")
    digest = hashlib.sha256(artifact).hexdigest()
    calibration = source.read_json(f"{run_rel}/calibration.json")
    parity = source.read_json(f"{run_rel}/export_parity.json")
    final_results = source.read_json("runs/FINAL_RESULTS.json")

    # reject 임계: calibration.json 의 선택 지점 (없으면 0.0 = 거부 없음).
    selected = (calibration or {}).get("selected") or {}
    if selected.get("threshold") is not None:
        threshold = float(selected["threshold"])
        basis = (
            f"calibration.json — 직접 촬영 val {calibration.get('validation_videos')}건 기준 "
            f"target precision {calibration.get('target_precision')}, 달성 precision "
            f"{selected.get('precision'):.4f} / coverage {selected.get('coverage'):.4f}. "
            "⚠️ 학습에 쓴 3인의 촬영본이라 다른 사용자 분포에서는 재확인이 필요하다"
        )
    else:
        threshold = 0.0
        basis = (
            "미설정(0.0 = 거부 없음). 이 번들에는 calibration 이 없다 "
            f"({(calibration or {}).get('reason', 'calibration.json 부재')}). "
            "Core 의 라벨된 라이브 셋으로 곡선은 측정했지만, 같은 셋으로 임계를 고르고 "
            "성능을 보고하면 순환이라 값을 박지 않았다"
        )

    bundle_name, run_note = RUNS[args.run]
    bundle = API_ROOT / "var/models" / bundle_name
    if bundle.exists():
        shutil.rmtree(bundle)  # 이전 세대 잔여 파일(live_debias.npy 등)이 섞이지 않게
    bundle.mkdir(parents=True)
    (bundle / "model_torchscript.pt").write_bytes(artifact)

    release = {
        "bundle": bundle_name,
        "created_at": datetime.now(UTC).isoformat(),
        "feature_version": FEATURE_VERSION,
        "model_name": MODEL_NAME,
        "num_classes": NUM_CLASSES,
        "max_sequence_length": MAX_SEQUENCE_LENGTH,
        "class_labels": labels,
        "serving": {
            "artifact": "model_torchscript.pt",
            "interface": SERVING_INTERFACE,
            # 이 모델은 손 하나만 본다 — 서버가 대표 손을 고르고 반대 손을 지운다
            # (app/ml/model.robust_motion_side). FULL view 로 주면 학습에 없는 입력이다.
            "view": "single_observed",
            "temperature": TEMPERATURE,
            "temperature_basis": TEMPERATURE_BASIS,
            "recommended_reject_threshold": threshold,
            "reject_threshold_basis": basis,
        },
        "source": {
            # 빌드 기계의 절대경로는 싣지 않는다 — 어느 커밋의 어느 run 인가면 충분하다.
            "repo": REPO,
            "ref": args.ref,
            "project": PROJECT,
            "run_dir": run_rel,
            "run_note": run_note,
            "artifact_sha256": digest,
            "export_parity": parity,
            "calibration": calibration,
            # ⚠️ 스튜디오/동일화자 수치다. 신규 사용자 기대치는 LOPO 평균을 쓸 것.
            "final_results": final_results,
        },
    }
    (bundle / "release.json").write_text(
        json.dumps(release, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"bundle    : {bundle}")
    print(f"interface : {SERVING_INTERFACE} (view=single_observed)")
    print(f"sha256    : {digest}")
    print(f"reject    : {threshold}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
