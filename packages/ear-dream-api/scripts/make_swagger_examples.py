"""Swagger(/docs) 요청 예시 생성 — 모델 학습 캐시(실클립 npy)에서 재구성한다.

산출물: app/examples/manifest.json + recognize_*.json
        (app/examples/__init__.py 가 로드해 Body(openapi_examples=...) 로 연결)

원리: npy 는 (T, 130, 3) 조립 결과 캐시다. 서버 assembly 는 얼굴 468(478) 중
FACE_MESH_IDS 78개, 포즈 33 중 POSE_MP_IDS 9개만 골라 쓰므로, 그 인덱스 자리에만
실측값을 넣고 나머지는 더미(0.5)로 채우면 서버가 조립한 결과가 원본 npy 와 일치한다.

크기 조정: openapi.json/Swagger UI 부담을 줄이려고 두 축의 변형을 실측 탐색한다.
  - frame_stride: 프레임 다운샘플 (t_ms 는 원본 시각 유지 — 서버 리샘플이 처리)
  - face_stride: 얼굴을 N프레임마다만 실음 (face 는 nullable — 서버 보간이 처리)
후보 변형들을 실제 앱(TestClient)에 POST 해서 **기대 단어로 recognized 되는 가장 작은
변형**을 고른다. 좌표 반올림은 하지 않는다 (설계 결정 1 — 예시도 계약을 따른다).

클립은 fold 0 의 val(unseen) 수어자 REAL03/04 를 쓴다 — 학습에 쓰인 수어자면
암기 확인밖에 안 되기 때문.

실행:  uv run python scripts/make_swagger_examples.py [--model-repo PATH]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

# 예시 생성 중 TestClient POST 가 var/archive 를 오염시키지 않게 아카이빙을 끈다
os.environ.setdefault("EAR_DREAM_ARCHIVE_ENABLED", "false")

from fastapi.testclient import TestClient

from app.examples import EXAMPLES_DIR, MANIFEST_PATH
from app.ml.keypoint_layout import (
    FACE,
    FACE_MESH_IDS,
    LEFT_HAND,
    POSE_MP_IDS,
    RIGHT_HAND,
)

# (clip_id, 기대 단어, 어휘 ID) — unseen(val) 수어자, 서로 다른 단어.
# 밥은 REAL04 가 아니라 REAL03 을 쓴다 — REAL04 는 가장 작은 변형(fs=3, cs=8)에서
# confidence 가 reject 임계(0.5) 아래로 떨어져 565KB 변형까지 가야 통과했다 (실측).
CLIPS = [
    ("NIA_SL_WORD1510_REAL03_F", "꿈", "w_1510"),
    ("NIA_SL_WORD1534_REAL03_F", "밥", "w_1534"),
]

FPS_MS = 1000.0 / 30.0  # AIHub 30fps

# 탐색할 변형 (frame_stride, face_stride). 크기 오름차순으로 시도해 첫 합격을 채택한다.
FRAME_STRIDES = [1, 2, 3]
FACE_STRIDES = [1, 2, 4, 8]


def build_frames(kp: np.ndarray, frame_stride: int = 1, face_stride: int = 1) -> list[dict]:
    """(T, 130, 3) npy → LandmarkFrame 목록. e2e 검증 스크립트와 동일한 재구성."""
    frames: list[dict] = []
    kept = 0
    for i in range(0, kp.shape[0], frame_stride):
        t_ms = 1000.0 + i * FPS_MS  # 원본 프레임 시각 유지
        frame: dict = {"t_ms": t_ms, "hands": [], "face": None, "pose": None}

        for block, label in ((LEFT_HAND, "Left"), (RIGHT_HAND, "Right")):
            hand = kp[i, block, :]
            if np.isnan(hand).any():
                continue  # 부분 결측 손은 관측 없음으로 처리 (극히 드묾)
            frame["hands"].append(
                {
                    "handedness_label": label,
                    "handedness_score": 0.99,
                    "landmarks": hand.tolist(),
                }
            )

        face = kp[i, FACE, :]  # (78, 3)
        if kept % face_stride == 0 and not np.isnan(face).all():
            full = np.full((468, 3), 0.5, dtype=np.float32)
            filled = face.copy()
            filled[np.isnan(filled)] = 0.5  # 서브셋 내 부분 결측은 더미로
            full[FACE_MESH_IDS] = filled
            frame["face"] = {"landmarks": full.tolist()}

        pose_full = np.full((33, 3), 0.5, dtype=np.float32)
        vis = [0.0] * 33
        any_pose = False
        for global_idx, mp_idx in POSE_MP_IDS.items():
            pt = kp[i, global_idx, :]
            if not np.isnan(pt).any():
                pose_full[mp_idx] = pt
                vis[mp_idx] = 1.0
                any_pose = True
        if any_pose:
            frame["pose"] = {"landmarks": pose_full.tolist(), "visibility": vis}

        frames.append(frame)
        kept += 1
    return frames


def build_request(frames: list[dict], request_id: str) -> dict:
    return {
        "session_id": "docs-demo",
        "request_id": request_id,
        "segment": {
            "frames": frames,
            "press_start_ms": frames[0]["t_ms"],
            "press_end_ms": frames[-1]["t_ms"],
            "boundary_mode": "manual",
            "capture": {
                # AIHub 스튜디오 촬영본 키포인트 캐시 기준 메타 (예시용)
                "source_width": 1920,
                "source_height": 1080,
                "facing_mode": "environment",
                "preview_mirrored": False,
                "delegate": "CPU",
                "landmarker_model_versions": {
                    "hand": "aihub-keypoint-cache",
                    "face": "aihub-keypoint-cache",
                    "pose": "aihub-keypoint-cache",
                },
                "client_version": "swagger-example",
            },
        },
    }


def dump(body: dict) -> str:
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def pick_variant(
    client: TestClient, kp: np.ndarray, clip_id: str, expected_label: str
) -> tuple[dict, dict[str, Any]]:
    """기대 단어로 recognized 되는 가장 작은 변형을 실측으로 고른다."""
    candidates = []
    for fs in FRAME_STRIDES:
        for cs in FACE_STRIDES:
            frames = build_frames(kp, frame_stride=fs, face_stride=cs)
            body = build_request(frames, f"docs-recognize-{clip_id}")
            candidates.append((len(dump(body).encode()), fs, cs, body, frames))
    candidates.sort(key=lambda c: c[0])

    print(f"\n== {clip_id} (기대: {expected_label}) — 크기 오름차순 탐색")
    for size, fs, cs, body, frames in candidates:
        res = client.post("/api/v1/recognize", json=body)
        top1, ok = "-", False
        if res.status_code == 200:
            data = res.json()
            cands = data.get("candidates") or []
            if data.get("status") == "recognized" and cands:
                top1 = f"{cands[0]['label']}({cands[0]['confidence']:.3f})"
                ok = cands[0]["label"] == expected_label
        print(
            f"  frame_stride={fs} face_stride={cs} frames={len(frames)} "
            f"size={size / 1024:.0f}KB → HTTP {res.status_code} top1={top1} {'채택' if ok else ''}"
        )
        if ok:
            meta = {
                "frame_stride": fs,
                "face_stride": cs,
                "frames": len(frames),
                "size_bytes": size,
                "top1": top1,
            }
            return body, meta
    raise SystemExit(f"{clip_id}: 어떤 변형도 {expected_label} 로 recognized 되지 않음")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model-repo",
        type=Path,
        default=(API_ROOT / "../../../Ear-Dream-Model").resolve(),
        help="Ear-Dream-Model 레포 경로 (data/keypoints/*.npy)",
    )
    args = parser.parse_args()

    from app.main import app  # 모델 로드 포함 — 시간이 걸린다

    client = TestClient(app)
    health = client.get("/health").json()
    if not health.get("model_loaded"):
        raise SystemExit("모델이 로드되지 않았다 — 체크포인트 경로를 확인할 것")

    manifest: dict[str, Any] = {"recognize": {}}
    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    for clip_id, label, word_id in CLIPS:
        kp = np.load(args.model_repo / "data" / "keypoints" / f"{clip_id}.npy").astype(np.float32)
        body, meta = pick_variant(client, kp, clip_id, label)
        filename = f"recognize_{word_id}.json"
        (EXAMPLES_DIR / filename).write_text(dump(body) + "\n", encoding="utf-8")
        manifest["recognize"][f"recognized_{word_id}"] = {
            "file": filename,
            "summary": f'실클립 — "{label}" 인식 ({meta["size_bytes"] // 1024}KB)',
            "description": (
                f"AIHub 실클립 {clip_id} (unseen 수어자, 모델 학습 캐시에서 재구성). "
                f'기대 결과: status=recognized, top-1 "{label}" ({word_id}). '
                f"크기를 줄이기 위해 프레임 {meta['frame_stride']}배 다운샘플, "
                f"얼굴은 {meta['face_stride']}프레임마다 1회만 실었다 (face 는 nullable — "
                f"서버 보간이 처리). 이 변형으로도 기대 단어가 나오는 것을 실측 확인함 "
                f"(top1={meta['top1']}). 재생성: scripts/make_swagger_examples.py"
            ),
        }

    # 프레임 부족 422 예시 — 첫 클립의 앞 3프레임 (min_frames 미달)
    kp = np.load(args.model_repo / "data" / "keypoints" / f"{CLIPS[0][0]}.npy").astype(np.float32)
    short_frames = build_frames(kp, frame_stride=1, face_stride=1)[:3]
    short_body = build_request(short_frames, "docs-recognize-too-few-frames")
    res = client.post("/api/v1/recognize", json=short_body)
    assert res.status_code == 422, f"422 예시가 422 가 아님: {res.status_code}"
    filename = "recognize_too_few_frames.json"
    (EXAMPLES_DIR / filename).write_text(dump(short_body) + "\n", encoding="utf-8")
    manifest["recognize"]["error_too_few_frames"] = {
        "file": filename,
        "summary": "프레임 부족 — 422 거절",
        "description": (
            f"실클립 {CLIPS[0][0]} 의 앞 3프레임만 보낸 경우. 세그먼트 최소 프레임 수"
            "(/model 의 min_frames) 미달로 Pydantic 검증이 422 를 반환한다. "
            "실측 확인함. 재생성: scripts/make_swagger_examples.py"
        ),
    }
    print(f"\n422 예시: {len(dump(short_body).encode()) / 1024:.0f}KB → HTTP {res.status_code}")

    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nwrote {MANIFEST_PATH}")
    for name, entry in manifest["recognize"].items():
        size = (EXAMPLES_DIR / entry["file"]).stat().st_size
        print(f"  {name}: {entry['file']} ({size / 1024:.0f}KB)")


if __name__ == "__main__":
    main()
