"""테스트 공용 픽스처 — 합성 요청 생성 헬퍼."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch) -> TestClient:
    # 테스트 중 아카이브·진단 기록이 실제 var/ 를 오염시키지 않게 임시 경로로 돌린다
    monkeypatch.setattr(settings, "archive_dir", str(tmp_path / "archive"))
    monkeypatch.setattr(settings, "diagnostics_dir", str(tmp_path / "diagnostics"))
    return TestClient(app)


def make_pose(seed: int = 0, shoulder_width: float = 0.3) -> dict:
    """어깨가 고정 배치된 포즈 33점. 손목(15/16)도 명시적으로 배치한다."""
    rng = np.random.default_rng(seed)
    landmarks = rng.uniform(0.3, 0.7, size=(33, 3)).astype(float).tolist()
    landmarks[11] = [0.5 + shoulder_width / 2, 0.5, 0.0]  # left shoulder
    landmarks[12] = [0.5 - shoulder_width / 2, 0.5, 0.0]  # right shoulder
    landmarks[15] = [0.7, 0.8, 0.0]  # left wrist
    landmarks[16] = [0.3, 0.8, 0.0]  # right wrist
    return {"landmarks": landmarks, "visibility": [1.0] * 33}


def make_hand(center: tuple[float, float], label: str = "Right", seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    pts = rng.uniform(-0.05, 0.05, size=(21, 3)).astype(float)
    pts[:, 0] += center[0]
    pts[:, 1] += center[1]
    pts[0] = [center[0], center[1], 0.0]  # landmark 0 = 손목
    return {
        "handedness_label": label,
        "handedness_score": 0.9,
        "landmarks": pts.tolist(),
    }


def make_frames(n: int = 40, with_hands: bool = True, with_pose: bool = True) -> list[dict]:
    frames = []
    for t in range(n):
        frame: dict = {"t_ms": float(t * 33), "hands": [], "face": None, "pose": None}
        if with_pose:
            frame["pose"] = make_pose(seed=t)
        if with_hands:
            # 오른 손목(0.3, 0.8) 근처에서 조금씩 움직이는 손 하나
            cx = 0.3 + 0.002 * t
            frame["hands"] = [make_hand((cx, 0.8), label="Right", seed=t)]
        frames.append(frame)
    return frames


def make_recognize_request(frames: list[dict], request_id: str = "req-1") -> dict:
    return {
        "session_id": "sess-1",
        "request_id": request_id,
        "segment": {
            "frames": frames,
            "press_start_ms": frames[0]["t_ms"] if frames else 0.0,
            "press_end_ms": frames[-1]["t_ms"] if frames else 0.0,
            "boundary_mode": "manual",
            "capture": {
                "source_width": 720,
                "source_height": 1280,
                "facing_mode": "user",
                "preview_mirrored": True,
                "delegate": "GPU",
                "landmarker_model_versions": {"hand": "test", "face": "test"},
                "client_version": "test",
            },
        },
    }
