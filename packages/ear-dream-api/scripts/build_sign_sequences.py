"""아바타 재생용 수어 시퀀스 번들 빌드 — 모델 레포 키포인트 → 앱 빌트인 자산 + 서버 매니페스트.

청인→농인 방향(문장 → 단어열 → 아바타 재생)의 **데이터 절반**이다. 인식(`/recognize`)과
달리 모델이 관여하지 않는다 — 사람이 실제로 수어를 한 클립의 좌표를 그대로 재생한다.

입력 (읽기 전용. 기본: ../../../Ear-Dream-Model — 이 레포에 복사하지 않는다):
    data/keypoints/{clip_id}.npy   (T, 130, 3) float16, kp130 레이아웃, 미검출 NaN
    data/manifest.csv              clip_id,word,signer_id,n_frames,hand_missing_rate,status

출력 (둘 다 이 스크립트가 재생성한다 — 손으로 고치지 말 것):
    packages/ear-dream-app/public/sign-sequences/{word_id}.bin   좌표 (커밋 대상)
    packages/ear-dream-app/public/sign-sequences/index.json      클라이언트 인덱스 (커밋 대상)
    packages/ear-dream-api/app/ml/data/sign_sequences.json       서버 매니페스트 (커밋 대상)

셋 다 커밋한다. **클론만으로 앱이 바로 돌아야 한다**는 것이 이 자산의 요구사항이다 —
좌표는 클라이언트 빌트인이고(서버가 매번 내려보내면 ngrok 대역폭을 먹는다), 원천 영상은
레포 밖에 있어서 별도 내려받기를 두면 클론한 사람이 재생을 못 본다. 300단어 17 MiB 는
그 대가로 받아들인 값이다.

⚠️ 그래서 이 스크립트를 돌리면 **17 MiB 짜리 변경이 생긴다.** 좌표가 실제로 바뀔 때만
돌릴 것 — 같은 입력으로 다시 돌리는 것은 무해하지만(결과가 같다), 추출을 다시 하면
좌표가 미세하게 달라져 300개 파일이 전부 수정된 것으로 잡힌다.

서버 매니페스트에 좌표가 없는 이유는 그대로다: 서버는 "이 단어에 시퀀스가 있는가"
(`no_sequence` 판정)만 알면 된다. 양쪽 `bundle_version` 이 같은지로 어긋남을 감지한다.

사용:
    uv run python scripts/build_sign_sequences.py
    uv run python scripts/build_sign_sequences.py --source /path/to/Ear-Dream-Model
    uv run python scripts/build_sign_sequences.py --strict-aihub-id   # 아래 「단어 매칭」


## kp130 레이아웃 일치 (2026-08-16 코드 검증)

`.npy` 는 모델 레포 `src/extract.py` 가 `src/keypoint_layout.py` 상수로 채운 배열이고,
서버 `app/ml/keypoint_layout.py` 는 그 포팅본이다. 두 모듈의 N_KP·블록 경계·POSE_MP_IDS·
FACE_MESH_IDS·FLIP_PERM 이 전부 일치함을 확인했다 (`--verify-layout` 으로 재확인 가능).
따라서 `.npy` 의 축 1 인덱스는 서버 상수로 그대로 해석된다:
    0..20 왼손 / 21..41 오른손 / 42..51 상체 포즈 / 52..129 얼굴 78점


## z 를 버린다 (`[:, :, :2]`)

인식 경로가 이미 z 를 쓰지 않고(`preprocess_spoter` 의 pose/hands/face 전부 `[:, :2]`),
이 레포는 tasks-vision↔Holistic 의 pose z 추출기 갭을 실측 확정해 z 를 신뢰하지 않기로
했다 (CLAUDE.md 「서빙 모델과 Ear-Dream-Model 레포」 z-off 채택 경위). 용량도 1/3 준다.


## fps 는 줄이지 않는다 (사용자 결정)

원본 프레임을 그대로 싣는다. `source_fps` 는 전처리 계약 문서가 명시한 AI Hub 30fps 를
인용한 값이다 (`app/ml/preprocess_spoter.py` 모듈 docstring) — ⚠️ **이 레포에서 원본
영상으로 실측한 값이 아니다**. 재생 속도가 어긋나 보이면 여기부터 의심할 것.


## 포맷: **단어별** int16 바이너리 + index.json (실측 근거)

300단어 실측 — 원본 **17.0 MiB, gzip 9.8 MiB** (단어당 평균 56.6 KiB).
(41단어 시절 환산치 17.5/9.8 MiB 와 거의 같다 — 추정이 맞았다.)

- **단어별 파일**로 나눈 이유: 클라이언트는 한 문장에 쓰이는 몇 단어만 필요하다. 단일
  번들이면 300단어 17.5 MiB 를 첫 재생 전에 전부 받아야 하는데, 애초에 시퀀스를
  빌트인으로 돌린 이유가 대역폭이다 — 한 번에 다 받으면 그 이유가 무너진다.
  단어당 평균 60 KiB 라 3단어 문장이면 180 KiB 다.
- **int16 바이너리**로 한 이유는 QUANT_SCALE 주석 참조 (JSON 대비 실측 3.4배 차이).
- 용량을 더 줄여야 하면 **얼굴 78점이 전체의 60%** 다 (130 중 78). 다만 비수지신호는
  수어의 문법 요소라(CLAUDE.md 랜드마크 절) 자르는 건 표현력 손실이다 — 재생 화면이
  얼굴을 실제로 그리는지 확인한 뒤 결정할 것.


## 시작·끝 rest 구간을 자르지 않는다

AI Hub 클립은 앞뒤에 정지 구간이 있어 아바타 재생이 굼떠 보일 수 있다. 그래도 자르지
않는 이유: 트리밍은 정책 결정이고(어느 정도 움직임을 "시작"으로 볼 것인가) 검증된 기준이
없다. 임의 기준으로 자르면 원본과 다른 두 번째 가공본이 생긴다. 필요해지면 **여기 한
곳에서** 하고 `BUNDLE_VERSION` 을 올린다.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

import numpy as np

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.ml.keypoint_layout import FACE, LEFT_HAND, N_KP, POSE, RIGHT_HAND
from app.ml.vocab import ID_TO_ENTRY, LABEL_TO_ENTRY, VOCAB_VERSION, VocabEntry

REPO_ROOT = API_ROOT.parents[1]

# 모델 레포는 이 레포의 형제 디렉토리에 있다 (CLAUDE.md). **읽기만** 한다.
DEFAULT_SOURCE = REPO_ROOT.parent / "Ear-Dream-Model"

# 앱 자산은 public/mediapipe 선례를 따른다 — 스크립트로 재생성 + .gitignore + 정적 서빙.
APP_OUT = REPO_ROOT / "packages/ear-dream-app/public/sign-sequences"
SERVER_MANIFEST = API_ROOT / "app/ml/data/sign_sequences.json"

# v2: 좌표 출처가 바뀌었다 — 모델 레포의 Holistic 추출본(41단어) → 이 레포의
# `extract_sign_videos.py` tasks API 추출본(300단어). 판본을 올리지 않으면 서버
# 매니페스트와 앱 자산이 어긋나도 감지되지 않는다.
BUNDLE_VERSION = "sign-seq-v2-2026-08-18"

# 전처리 계약 문서 인용값 — 이 레포 실측 아님 (모듈 docstring 「fps」 절)
SOURCE_FPS = 30.0

# ---------------------------------------------------------------- 좌표 인코딩
# int16 고정소수점. 클라이언트는 `new Int16Array(buf)` 한 줄로 읽고 QUANT_SCALE 로 나눈다.
#
# float16 을 그대로 쓰지 않는 이유: JS 에 Float16Array 가 사실상 없어 클라이언트가 비트
# 조작으로 디코드해야 한다. JSON 을 쓰지 않는 이유: 소수점 3자리로 반올림해도 실측 3.4배다
# (한 단어 65.5KB → 226KB). int16 은 크기가 float16 과 같으면서 디코드가 나눗셈 하나다.
#
# 좌표는 MediaPipe 정규화 좌표라 실측 범위가 0.000..1.031 이다. 4096 배율이면 ±7.99 까지
# 표현되고 해상도는 1/4096 ≈ 0.00024 (1080px 환산 0.26px) 로 렌더링에 충분하다.
QUANT_SCALE = 4096
# 미검출(NaN) 표식. 클라이언트는 이 값을 만나면 **그 프레임의 그 점을 그리지 않는다** —
# 보간·직전값 유지 금지. 결측 대치는 정책 결정이고 여기(재생 경로)에는 근거가 없다.
NAN_SENTINEL = -32768
QUANT_LIMIT = 32767


def quantize(xy: np.ndarray) -> np.ndarray:
    """(T, 130, 2) float → int16. NaN 은 NAN_SENTINEL, 범위 초과는 즉시 실패."""
    finite = np.isfinite(xy)
    scaled = np.zeros(xy.shape, dtype=np.float64)
    scaled[finite] = np.round(xy[finite].astype(np.float64) * QUANT_SCALE)
    if finite.any() and np.abs(scaled[finite]).max() >= QUANT_LIMIT:
        raise SystemExit(
            f"좌표가 int16 표현 범위를 벗어났다 (max={np.abs(scaled[finite]).max()}). "
            "조용히 잘라내면 아바타가 뒤틀리므로 QUANT_SCALE 을 재검토할 것."
        )
    out = np.full(xy.shape, NAN_SENTINEL, dtype=np.int16)
    out[finite] = scaled[finite].astype(np.int16)
    return out


# ------------------------------------------------------------------ 클립 선정
def missing_rate(kp_xy: np.ndarray) -> float:
    """130 키포인트 × xy 전체의 미검출(NaN) 비율."""
    return float(np.isnan(kp_xy).mean())


def choose_representative(candidates: list[dict]) -> dict:
    """단어별 대표 클립 1개를 고른다.

    정렬 키 (오름차순):
      1) **미검출 비율** (0.1%p 단위로 반올림). 재생 경로에서 결측은 곧 "그 프레임에
         손이 안 그려진다" 이므로, 아바타가 깨져 보이는지를 직접 결정하는 유일한 지표다.
         맨 앞에 두는 이유가 이것이다.
         ※ 반올림하는 이유: 0.2% 와 0.3% 차이는 눈에 안 보이는데 그 미세한 차가 2)번
           기준을 무력화해 버린다. 실질 동률은 동률로 취급한다.
      2) **그 단어 클립들의 n_frames 중앙값과의 거리**. 비정상적으로 짧은(동작이 잘린)
         클립과 긴(머뭇거린) 클립을 피해 전형적인 속도의 조음을 고른다. 품질 지표가
         아니라 대표성 지표라서 2순위다.
      3) clip_id 사전순 — 재실행 결과를 고정하기 위한 결정론 타이브레이커.

    ⚠️ 이 기준은 **자동 지표만** 본다. "사람이 보기에 자연스러운 조음인가" 는 판정하지
    않는다. 시연 전 육안 확인이 필요하다.
    """
    frames = sorted(c["n_frames"] for c in candidates)
    median = float(np.median(frames))
    return min(
        candidates,
        key=lambda c: (
            round(c["missing_rate"], 3),
            abs(c["n_frames"] - median),
            c["clip_id"],
        ),
    )


# ------------------------------------------------------------------ 단어 매칭
_CLIP_WORD_RE = re.compile(r"^NIA_SL_WORD(\d+)_")


def resolve_entry(clip_id: str, word: str, strict: bool) -> tuple[VocabEntry | None, bool]:
    """(어휘 항목, 원본 단어번호 불일치 여부).

    기본은 **한국어 라벨 매칭**이다 (어휘 라벨은 유일성이 보장돼 있다 — vocab.py assert).
    AI Hub 는 같은 단어가 서로 다른 원본 단어 번호로 두 번 수록된 경우가 있어
    (자다 WORD1377/WORD1544, 없다 1384/1637, 아기 1189/2005, 귀엽다 1314/2059),
    번호로만 매칭하면 실제로는 있는 시퀀스를 놓친다.

    ⚠️ 라벨 매칭은 "같은 한국어 표기 = 같은 수어 동작" 을 전제한다. 위 4단어는 동음이의가
    아니라 안전하다고 판단했지만 **육안 검증은 안 됐다.** 번호 일치만 쓰려면
    `--strict-aihub-id` (37단어로 줄어든다).
    """
    entry = LABEL_TO_ENTRY.get(word)
    if entry is None:
        return None, False
    match = _CLIP_WORD_RE.match(clip_id)
    clip_word_id = f"{int(match.group(1)):04d}" if match else None
    crossed = clip_word_id is not None and clip_word_id != entry.aihub_word_id
    if crossed and strict:
        return None, True
    return entry, crossed


# ---------------------------------------------------------------------- main
def main() -> int:
    parser = argparse.ArgumentParser(description="아바타 재생용 수어 시퀀스 번들 빌드")
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SOURCE, help="모델 레포 경로 (읽기 전용)"
    )
    parser.add_argument("--out", type=Path, default=APP_OUT, help="앱 자산 출력 디렉토리")
    parser.add_argument(
        "--strict-aihub-id",
        action="store_true",
        help="원본 단어 번호가 정확히 일치하는 클립만 쓴다 (resolve_entry docstring)",
    )
    parser.add_argument(
        "--verify-layout",
        action="store_true",
        help="모델 레포 src/keypoint_layout.py 와 서버 포팅본의 상수 일치를 확인하고 끝낸다",
    )
    args = parser.parse_args()
    source: Path = args.source

    if args.verify_layout:
        return verify_layout(source)

    manifest_csv = source / "data/manifest.csv"
    keypoint_dir = source / "data/keypoints"
    for required in (manifest_csv, keypoint_dir):
        if not required.exists():
            print(f"필수 입력이 없다: {required}", file=sys.stderr)
            return 1

    with manifest_csv.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))

    # ---- 후보 수집: status ok + 어휘에 있는 단어 + .npy 존재
    by_word: dict[str, list[dict]] = {}
    crossed_clips: set[str] = set()  # 라벨은 맞고 원본 단어 번호가 다른 clip_id 들
    skipped_status = 0
    for row in rows:
        if row["status"] != "ok":
            skipped_status += 1
            continue
        entry, crossed = resolve_entry(row["clip_id"], row["word"], args.strict_aihub_id)
        if entry is None:
            continue
        path = keypoint_dir / f"{row['clip_id']}.npy"
        if not path.exists():
            print(f"⚠️ manifest 에는 있으나 .npy 가 없다: {path.name}", file=sys.stderr)
            continue
        # 미검출 비율은 manifest 의 hand_missing_rate(손만) 로는 부족하다 — 아바타는
        # 포즈·얼굴도 그리므로 130 키포인트 전체를 직접 센다.
        xy = np.load(path)[:, :, :2].astype(np.float32)
        if xy.shape[1] != N_KP:
            raise SystemExit(f"{path.name}: 키포인트 수 {xy.shape[1]} != {N_KP} (레이아웃 불일치)")
        by_word.setdefault(entry.id, []).append(
            {
                "clip_id": row["clip_id"],
                "signer_id": row["signer_id"],
                "n_frames": int(xy.shape[0]),
                "missing_rate": missing_rate(xy),
                "path": path,
            }
        )
        if crossed:
            crossed_clips.add(row["clip_id"])

    if not by_word:
        print(
            "어휘와 겹치는 클립이 하나도 없다 — 어휘 판본이나 manifest 를 확인할 것",
            file=sys.stderr,
        )
        return 1

    # ---- 대표 클립 선정 + 인코딩
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.bin"):
        stale.unlink()

    sequences: list[dict] = []
    total_bytes = 0
    for word_id in sorted(by_word):
        entry = ID_TO_ENTRY[word_id]
        chosen = choose_representative(by_word[word_id])
        xy = np.load(chosen["path"])[:, :, :2].astype(np.float32)
        payload = quantize(xy).astype("<i2").tobytes()  # little-endian 고정
        (out_dir / f"{word_id}.bin").write_bytes(payload)
        total_bytes += len(payload)
        sequences.append(
            {
                "word_id": word_id,
                "label": entry.label,
                "sequence_key": word_id,  # 현재는 어휘 ID 와 동일 (아래 서버 매니페스트 주석)
                "frame_count": chosen["n_frames"],
                "missing_rate": round(chosen["missing_rate"], 5),
                "source_clip_id": chosen["clip_id"],
                "source_signer_id": chosen["signer_id"],
                "candidate_count": len(by_word[word_id]),
            }
        )

    # ---- 클라이언트 인덱스
    index = {
        "bundle_version": BUNDLE_VERSION,
        "vocab_version": VOCAB_VERSION,
        "format": {
            "encoding": "int16-le",
            "quant_scale": QUANT_SCALE,
            "nan_sentinel": NAN_SENTINEL,
            # [frame][keypoint][xy] row-major. 길이 = frame_count × 130 × 2
            "shape": ["frame", "keypoint", "xy"],
            "keypoint_count": N_KP,
            "channel_count": 2,
            "blocks": {
                "left_hand": [LEFT_HAND[0], LEFT_HAND[-1] + 1],
                "right_hand": [RIGHT_HAND[0], RIGHT_HAND[-1] + 1],
                "pose": [POSE[0], POSE[-1] + 1],
                "face": [FACE[0], FACE[-1] + 1],
            },
            "source_fps": SOURCE_FPS,
            "coordinate_space": "mediapipe-normalized-16x9",
        },
        "sequences": [
            {k: s[k] for k in ("word_id", "label", "sequence_key", "frame_count")}
            for s in sequences
        ],
    }
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    # ---- 서버 매니페스트 (커밋 대상 — 좌표 없음)
    SERVER_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    SERVER_MANIFEST.write_text(
        json.dumps(
            {
                "bundle_version": BUNDLE_VERSION,
                "vocab_version": VOCAB_VERSION,
                "source_fps": SOURCE_FPS,
                "asset_path": "sign-sequences",
                "selection": (
                    "단어별 대표 1클립. 정렬 키: 미검출비율(0.1%p 반올림) → n_frames 중앙값과의 "
                    "거리 → clip_id. 근거는 scripts/build_sign_sequences.py choose_representative"
                ),
                "sequences": sequences,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )

    # ---- 요약
    frames = [s["frame_count"] for s in sequences]
    print(f"단어         : {len(sequences)} / 어휘 {len(ID_TO_ENTRY)}")
    print(f"프레임       : 합 {sum(frames)} / 단어당 중앙값 {int(np.median(frames))}")
    print(f"좌표 용량    : {total_bytes / 1024:.0f} KiB (index.json 제외)")
    if sequences:
        per_word = total_bytes / len(sequences)
        print(
            f"단어당 평균  : {per_word / 1024:.1f} KiB → 300단어 환산 {per_word * 300 / 1024**2:.1f} MiB"
        )
    print(f"앱 자산      : {out_dir}")
    print(f"서버 매니페스트: {SERVER_MANIFEST}")
    if skipped_status:
        print(f"status != ok 제외: {skipped_status}건")
    adopted_crossed = [s for s in sequences if s["source_clip_id"] in crossed_clips]
    if adopted_crossed:
        print(
            "⚠️ 라벨은 같으나 AI Hub 원본 단어 번호가 다른 클립을 채택했다 "
            "(육안 검증 필요 — resolve_entry docstring):"
        )
        for seq in adopted_crossed:
            entry = ID_TO_ENTRY[seq["word_id"]]
            print(
                f"    {entry.id}(WORD{entry.aihub_word_id}) {entry.label} ← {seq['source_clip_id']}"
            )
    return 0


def verify_layout(source: Path) -> int:
    """모델 레포 정본과 서버 포팅본의 kp130 상수 일치 확인 (train/serve skew 방어선)."""
    sys.path.insert(0, str(source))
    try:
        import src.keypoint_layout as ref  # type: ignore[import-not-found]
    except ImportError as exc:
        print(f"모델 레포 레이아웃 모듈을 못 읽었다: {exc}", file=sys.stderr)
        return 1
    import app.ml.keypoint_layout as srv

    scalars = [
        "N_KP",
        "LEFT_HAND",
        "RIGHT_HAND",
        "POSE",
        "FACE",
        "HAND_N",
        "NOSE",
        "NECK",
        "L_SHOULDER",
        "R_SHOULDER",
        "L_ELBOW",
        "R_ELBOW",
        "L_WRIST",
        "R_WRIST",
        "L_HIP",
        "R_HIP",
        "POSE_MP_IDS",
        "FACE_MESH_IDS",
        "FINGER_GROUPS_LOCAL",
        "N_CH",
        "FEAT_DIM",
    ]
    bad = [name for name in scalars if getattr(ref, name) != getattr(srv, name)]
    if not np.array_equal(ref.FLIP_PERM, srv.FLIP_PERM):
        bad.append("FLIP_PERM")
    if bad:
        print(f"❌ kp130 레이아웃 불일치: {bad}", file=sys.stderr)
        return 1
    print(
        f"✅ kp130 레이아웃 일치 ({len(scalars) + 1}개 상수) — .npy 축 1 을 서버 상수로 해석 가능"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
