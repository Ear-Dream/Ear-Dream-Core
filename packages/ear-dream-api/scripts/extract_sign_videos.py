"""수어 영상 → kp130 키포인트 (.npy + manifest.csv).

`build_sign_sequences.py` 가 먹는 형태로 떨어뜨린다. 즉 이 스크립트는 **모델 레포가
하던 추출 단계를 대신**할 뿐이고, 자산 번들을 만드는 것은 여전히 빌드 스크립트다.
두 단계를 합치지 않는 이유: 클립 선정·양자화·매니페스트 규칙이 이미 그쪽에 있고
검증돼 있다. 여기서 다시 구현하면 규칙이 두 벌이 된다.

사용:
    uv run --group extract python scripts/extract_sign_videos.py --videos ~/Downloads/...
    uv run python scripts/build_sign_sequences.py --source var/sign-videos-kp

## 왜 tasks API 인가

모델 레포의 추출기는 `mp.solutions.holistic` 을 썼는데 mediapipe 1.x 에서 **legacy
solutions 가 통째로 사라졌다**. 대신 tasks API 의 Pose/Hand/Face Landmarker 를 각각
돌린다. 부수 효과가 하나 있는데 나쁘지 않다 — **앱이 이미 내려받아 쓰는 그 `.task`
모델 파일을 그대로 쓴다**(`packages/ear-dream-app/public/mediapipe/models/`). 오프라인
추출과 앱의 실시간 추출이 같은 모델 계열이 된다.

⚠️ 그래서 이 스크립트로 다시 뽑은 좌표는 **기존 41단어 자산(Holistic 추출)과 같지
않다.** 섞어 쓰면 안 되고, 300단어를 통째로 다시 뽑아 번들을 갈아끼우는 것이 전제다.
z 는 이 레포가 신뢰하지 않기로 한 값이지만(CLAUDE.md) .npy 에는 남겨 둔다 — 버리는
건 빌드 스크립트가 하고, 나중에 3D 로 갈 때 재추출을 면한다.

## 손 좌우 배정

Holistic 은 좌우를 갈라 줬지만 HandLandmarker 는 "손 2개 + handedness 라벨" 을 준다.
**포즈 손목과의 거리로 배정하고 라벨은 폴백으로만 쓴다** — 서버 `assembly.py` 가 라이브
좌표에 하는 것과 같은 원칙이다. 라벨은 영상이 미러링되지 않았다는 전제에 기대는데,
그 전제가 깨져도 기하는 안 깨진다.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.ml.keypoint_layout import (
    FACE,
    FACE_MESH_IDS,
    L_SHOULDER,
    L_WRIST,
    LEFT_HAND,
    N_KP,
    NECK,
    NOSE,
    POSE_MP_IDS,
    R_SHOULDER,
    R_WRIST,
    RIGHT_HAND,
)

REPO_ROOT = API_ROOT.parents[1]
MODEL_DIR = REPO_ROOT / "packages/ear-dream-app/public/mediapipe/models"
DEFAULT_OUT = API_ROOT / "var/sign-videos-kp"

# 파일명 규약: 001_나_WORD1157_F.mp4 (순번_라벨_원본단어번호_촬영자)
FILENAME_RE = re.compile(r"^(?P<seq>\d+)_(?P<word>.+)_WORD(?P<aihub>\d+)_(?P<signer>[^_.]+)\.mp4$")

# 포즈 점의 visibility 문턱. 모델 레포 추출기와 같은 값 — 낮으면 미검출로 본다.
MIN_VISIBILITY = 0.1

# 얼굴 ROI 한 변 = 어깨 너비 × 이 값. 얼굴 검출기는 **전신 1920×1080 프레임에서는
# 얼굴을 아예 못 찾는다** (프레임 대비 얼굴이 너무 작다). Holistic 이 내부에서 하던
# 것처럼 포즈로 머리 둘레를 잘라 넣는다. 실측상 1.0~2.4 전 구간에서 검출되므로
# 머리 움직임 여유를 두고 가운데 값을 쓴다.
FACE_ROI_SCALE = 1.6
# ROI 중심을 코보다 살짝 위로 (어깨 너비 대비). 이마·정수리가 잘리지 않게.
FACE_ROI_RISE = 0.1


def build_landmarkers():
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    def opts(cls, name, **extra):
        path = MODEL_DIR / name
        if not path.exists():
            raise SystemExit(f"모델 파일이 없다: {path}\n앱에서 `pnpm setup:mediapipe` 를 먼저 돌릴 것.")
        return cls(
            # CPU 고정 — macOS 에서 기본 GPU(Metal) 위임이 초기화 중 죽는다.
            # 오프라인 배치라 속도보다 돌아가는 게 우선이다.
            base_options=mp_python.BaseOptions(
                model_asset_path=str(path),
                delegate=mp_python.BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.VIDEO,
            **extra,
        )

    def cls_face_options(mp_python, vision):
        path = MODEL_DIR / "face_landmarker.task"
        return vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(
                model_asset_path=str(path),
                delegate=mp_python.BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
        )

    return (
        vision.PoseLandmarker.create_from_options(
            opts(vision.PoseLandmarkerOptions, "pose_landmarker_lite.task")
        ),
        vision.HandLandmarker.create_from_options(
            opts(vision.HandLandmarkerOptions, "hand_landmarker.task", num_hands=2)
        ),
        # 얼굴만 IMAGE 모드다 — ROI 가 프레임마다 옮겨다녀서 VIDEO 모드의 추적이
        # 오히려 어긋난다. 잘라 넣는 이상 매 프레임 새로 찾는 편이 정직하다.
        vision.FaceLandmarker.create_from_options(
            cls_face_options(mp_python, vision)
        ),
    )


def frame_from_results(pose_res, hand_res) -> np.ndarray:
    """포즈·손 결과 → (130, 3) float32. 얼굴은 ROI 를 잘라 따로 채운다. 미검출은 NaN."""
    frame = np.full((N_KP, 3), np.nan, dtype=np.float32)

    if pose_res.pose_landmarks:
        lms = pose_res.pose_landmarks[0]
        for global_idx, mp_idx in POSE_MP_IDS.items():
            lm = lms[mp_idx]
            if getattr(lm, "visibility", 1.0) >= MIN_VISIBILITY:
                frame[global_idx] = (lm.x, lm.y, lm.z)
        left, right = frame[L_SHOULDER], frame[R_SHOULDER]
        if not (np.isnan(left).any() or np.isnan(right).any()):
            frame[NECK] = (left + right) / 2.0  # 합성점

    for block, landmarks in assign_hands(hand_res, frame):
        for i, lm in enumerate(landmarks):
            frame[block[i]] = (lm.x, lm.y, lm.z)

    return frame


def fill_face(frame: np.ndarray, rgb, face_landmarker) -> None:
    """포즈로 머리 둘레를 잘라 얼굴을 검출하고, 좌표를 원본 프레임 기준으로 되돌린다."""
    import mediapipe as mp

    height, width, _ = rgb.shape
    nose = frame[NOSE][:2]
    left, right = frame[L_SHOULDER][:2], frame[R_SHOULDER][:2]
    if np.isnan(nose).any() or np.isnan(left).any() or np.isnan(right).any():
        return

    span = float(np.hypot((left[0] - right[0]) * width, (left[1] - right[1]) * height))
    half = int(span * FACE_ROI_SCALE / 2)
    if half <= 0:
        return
    center_y = int(nose[1] * height - span * FACE_ROI_RISE)
    x0, x1 = max(0, int(nose[0] * width) - half), min(width, int(nose[0] * width) + half)
    y0, y1 = max(0, center_y - half), min(height, center_y + half)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return

    crop = np.ascontiguousarray(rgb[y0:y1, x0:x1])
    result = face_landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=crop))
    if not result.face_landmarks:
        return

    crop_w, crop_h = x1 - x0, y1 - y0
    for k, mesh_id in enumerate(FACE_MESH_IDS):
        lm = result.face_landmarks[0][mesh_id]
        frame[FACE[k]] = (
            (x0 + lm.x * crop_w) / width,
            (y0 + lm.y * crop_h) / height,
            # z 는 얼굴 크기 기준이라 원본 x 스케일로 되돌린다 (다른 부위와 단위를 맞춘다).
            lm.z * crop_w / width,
        )


def assign_hands(hand_res, frame: np.ndarray):
    """검출된 손을 좌/우 블록에 배정한다. 포즈 손목 거리 우선, handedness 폴백."""
    hands = list(hand_res.hand_landmarks or [])
    if not hands:
        return []

    wrists = {"left": frame[L_WRIST][:2], "right": frame[R_WRIST][:2]}
    taken: dict[str, int] = {}

    for index, landmarks in enumerate(hands):
        point = np.array([landmarks[0].x, landmarks[0].y], dtype=np.float32)
        distances = {
            side: float(np.hypot(*(point - wrist)))
            for side, wrist in wrists.items()
            if not np.isnan(wrist).any()
        }
        if distances:
            side = min(distances, key=distances.get)
        else:
            # 포즈가 없을 때만 라벨에 기댄다 (영상 미러링 여부에 의존한다).
            label = hand_res.handedness[index][0].category_name.lower()
            side = "left" if label == "left" else "right"
        # 두 손이 같은 쪽으로 몰리면 더 가까운 쪽만 남긴다 — 겹쳐 쓰면 한 손이 사라진다.
        if side in taken:
            other = taken[side]
            keep = index if distances.get(side, 9e9) < _wrist_distance(hands[other], wrists[side]) else other
            drop = other if keep == index else index
            taken[side] = keep
            free = "right" if side == "left" else "left"
            if free not in taken:
                taken[free] = drop
        else:
            taken[side] = index

    return [
        (LEFT_HAND if side == "left" else RIGHT_HAND, hands[index])
        for side, index in taken.items()
    ]


def _wrist_distance(landmarks, wrist) -> float:
    if np.isnan(wrist).any():
        return 9e9
    return float(np.hypot(landmarks[0].x - wrist[0], landmarks[0].y - wrist[1]))


def extract_video(path: Path) -> tuple[np.ndarray, float]:
    """영상 1개 → (T, 130, 3). **검출기는 클립마다 새로 만든다.**

    VIDEO 모드는 타임스탬프가 단조 증가해야 해서 클립을 넘어 재사용할 수 없고,
    재사용하면 앞 단어의 추적 상태가 다음 단어 첫 프레임에 샌다 — 단어별로 독립인
    자산을 만드는 중이라 그건 조용한 오염이다.
    """
    import cv2
    import mediapipe as mp

    pose, hand, face = build_landmarkers()
    capture = cv2.VideoCapture(str(path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    frames: list[np.ndarray] = []
    try:
        index = 0
        while True:
            ok, bgr = capture.read()
            if not ok:
                break
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            # VIDEO 모드는 타임스탬프가 단조 증가해야 한다 — 프레임 번호로 만든다.
            timestamp = int(index * 1000 / fps)
            frame = frame_from_results(
                pose.detect_for_video(image, timestamp),
                hand.detect_for_video(image, timestamp),
            )
            fill_face(frame, rgb, face)
            frames.append(frame)
            index += 1
    finally:
        capture.release()
        for landmarker in (pose, hand, face):
            landmarker.close()

    if not frames:
        return np.empty((0, N_KP, 3), dtype=np.float32), fps
    return np.stack(frames), fps


def main() -> int:
    parser = argparse.ArgumentParser(description="수어 영상 → kp130 키포인트")
    parser.add_argument("--videos", type=Path, required=True, help="mp4 가 든 디렉토리")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="출력 루트")
    parser.add_argument("--limit", type=int, default=0, help="앞에서 N개만 (시험용)")
    args = parser.parse_args()

    videos = sorted(p for p in args.videos.glob("*.mp4"))
    if args.limit:
        videos = videos[: args.limit]
    if not videos:
        raise SystemExit(f"mp4 를 찾지 못했다: {args.videos}")

    keypoint_dir = args.out / "data/keypoints"
    keypoint_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for order, video in enumerate(videos, start=1):
        match = FILENAME_RE.match(video.name)
        if match is None:
            print(f"⚠️ 파일명 규약과 다르다, 건너뜀: {video.name}", file=sys.stderr)
            continue

        keypoints, fps = extract_video(video)
        # macOS 파일명은 NFD(자모 분리)다 — 그대로 쓰면 어휘 라벨("나")과 글자가
        # 달라 빌드가 한 단어도 못 찾는다. 눈으로는 구분이 안 되는 종류의 사고다.
        word = unicodedata.normalize("NFC", match["word"])
        clip_id = f"NIA_SL_WORD{int(match['aihub']):04d}_REAL01_{match['signer']}"
        np.save(keypoint_dir / f"{clip_id}.npy", keypoints.astype(np.float16))

        hand_xy = keypoints[:, list(LEFT_HAND) + list(RIGHT_HAND), :2]
        missing = float(np.isnan(hand_xy).all(axis=(1, 2)).mean()) if len(keypoints) else 1.0
        rows.append(
            {
                "clip_id": clip_id,
                "word": word,
                "signer_id": match["signer"],
                "n_frames": len(keypoints),
                "hand_missing_rate": f"{missing:.4f}",
                "status": "ok" if len(keypoints) else "empty",
            }
        )
        print(f"[{order}/{len(videos)}] {word:8} {len(keypoints):4}프레임 "
              f"{fps:.0f}fps 손미검출 {missing:.1%}", flush=True)

    manifest = args.out / "data/manifest.csv"
    with manifest.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=["clip_id", "word", "signer_id", "n_frames", "hand_missing_rate", "status"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{len(rows)}개 추출 완료 → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
