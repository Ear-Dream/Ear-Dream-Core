"""아카이브(`var/archive/`) 재생 분석 — 저장된 /recognize 요청을 서버 파이프라인에
오프라인으로 태워 진단 레코드(app/services/diagnostics 와 동일 형식)를 만들고,
요약 테이블을 stdout 에 출력한다.

사용:
    uv run python scripts/replay_archive.py                      # 전체
    uv run python scripts/replay_archive.py --session 173fab2d   # 세션 prefix 필터 (반복 가능)
    uv run python scripts/replay_archive.py --exclude e2e-       # 세션 prefix 제외 (반복 가능)
    uv run python scripts/replay_archive.py --json               # 기계 판독용 JSON 출력
    uv run python scripts/replay_archive.py --no-write           # 진단 레코드 저장 생략

진단 레코드는 라이브 기록과 섞이지 않게 `var/diagnostics/replay/{session}/{request}.json`
에 저장한다. 좌표 원본은 아카이브에 있으므로 레코드에는 요약 통계만 실린다.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import numpy as np
from pydantic import ValidationError

from app.api.v1.recognize import _quality_issues
from app.core.config import settings
from app.ml.assembly import assemble_frames
from app.ml.model import get_model_state
from app.ml.preprocess import PREPROCESS_VERSION, preprocess_eval
from app.ml.vocab import VOCAB_VERSION
from app.schemas.recognition import (
    PreprocessInfo,
    RecognitionResult,
    RecognitionStatus,
    RecognizeRequest,
    SignCandidate,
)
from app.services.diagnostics import (
    build_recognize_diagnostics,
    write_diagnostics_record,
)


# ---------------------------------------------------------------- 재생 파이프라인
def replay_one(request: RecognizeRequest) -> dict[str, Any]:
    """아카이브 요청 하나를 라우트와 동일한 결정 흐름으로 재생해 진단 레코드를 만든다."""
    state = get_model_state()
    kp = assemble_frames(request.segment.frames, settings.pose_visibility_threshold)
    blocking, advisory = _quality_issues(kp)

    pp = None
    probs = None
    if blocking:
        result = RecognitionResult(
            request_id=request.request_id,
            status=RecognitionStatus.low_quality,
            candidates=[],
            quality_issues=blocking + advisory,
            preprocess=None,
            model_version=state.model_version,
            vocab_version=VOCAB_VERSION,
        )
    else:
        frames = request.segment.frames
        # v2 등방 정규화의 AR 은 요청의 실측 해상도에서, use_z 는 체크포인트 계약에서
        # 온다 (라우트와 동일 배선)
        capture = request.segment.capture
        aspect_ratio = capture.source_width / capture.source_height
        pp = preprocess_eval(kp, aspect_ratio=aspect_ratio, use_z=state.use_z)
        probs = state.predict_probs(pp.x)
        order = np.argsort(probs)[::-1][: settings.recognize_top_k]
        best = float(probs[order[0]])
        if best < settings.reject_threshold:
            status, candidates = RecognitionStatus.rejected, []
        else:
            status = RecognitionStatus.recognized
            candidates = [
                SignCandidate(
                    id=state.class_entries[i].id,
                    label=state.class_entries[i].label,
                    confidence=float(probs[i]),
                )
                for i in order
            ]
        result = RecognitionResult(
            request_id=request.request_id,
            status=status,
            candidates=candidates,
            quality_issues=advisory,
            preprocess=PreprocessInfo(
                used_start_ms=frames[pp.used_start_index].t_ms,
                used_end_ms=frames[max(pp.used_end_index - 1, 0)].t_ms,
                used_frame_count=pp.used_frame_count,
                interpolated_frame_count=pp.interpolated_frame_count,
                preprocess_version=PREPROCESS_VERSION,
            ),
            model_version=state.model_version,
            vocab_version=VOCAB_VERSION,
        )

    return build_recognize_diagnostics(request, kp, result, pp=pp, probs=probs)


# ---------------------------------------------------------------- 행/집계
def _row_from_record(session: str, request_id: str, rec: dict[str, Any]) -> dict[str, Any]:
    req, asm = rec["request"], rec["assembly"]
    mo = rec.get("model_output")
    top3 = "-"
    top1_label, top1_prob = "-", None
    if mo is not None:
        sm = mo["softmax"]
        top1_label, top1_prob = sm[0]["label"], sm[0]["prob"]
        top3 = " ".join(f"{e['label']}({e['prob']:.2f})" for e in sm[:3])
    pre = rec.get("preprocess") or {}
    norm = (pre.get("normalization") or {}) if pre else {}
    post = norm.get("post_norm") or {}
    hand_z = post.get("hand_z") or {}
    return {
        "session": session,
        "request_id": request_id,
        "frames": req["frame_count"],
        "resolution": f"{req['source_width']}x{req['source_height']}",
        "approx_fps": req.get("approx_fps"),
        "hand_ratio": asm.get("hand_present_ratio"),
        "shoulder_vis": (asm.get("shoulder_visibility") or {}).get("mean"),
        "shoulder_scale": norm.get("shoulder_width_scale"),
        "hand_z_mean": hand_z.get("mean"),
        "interp": (pre.get("trim") or {}).get("interpolated_frame_count"),
        "used_frames": (pre.get("trim") or {}).get("used_frame_count"),
        "top1_label": top1_label,
        "top1_prob": top1_prob,
        "top3": top3,
        "status": rec["response"]["status"],
        "issues": ",".join(rec["response"]["quality_issues"]) or "-",
    }


def _fmt(v: Any, spec: str = ".2f") -> str:
    if v is None:
        return "-"
    if isinstance(v, float):
        return format(v, spec)
    return str(v)


def _num_summary(values: list[float | None]) -> dict[str, float] | None:
    xs = [v for v in values if v is not None and math.isfinite(v)]
    if not xs:
        return None
    arr = np.asarray(xs, dtype=np.float64)
    return {
        "n": len(xs),
        "mean": float(arr.mean()),
        "median": float(np.median(arr)),
        "min": float(arr.min()),
        "max": float(arr.max()),
    }


def _hist_text(values: list[float | None], lo: float = 0.0, hi: float = 1.0, bins: int = 10) -> str:
    xs = [v for v in values if v is not None]
    if not xs:
        return "  (값 없음)"
    counts, edges = np.histogram(np.asarray(xs), bins=bins, range=(lo, hi))
    peak = max(int(counts.max()), 1)
    lines = []
    for i, c in enumerate(counts):
        bar = "#" * round(int(c) / peak * 40)
        lines.append(f"  [{edges[i]:.1f}, {edges[i + 1]:.1f}) {int(c):3d} {bar}")
    return "\n".join(lines)


def aggregate(rows: list[dict[str, Any]], invalid: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts = Counter(r["status"] for r in rows)
    top1_counts = Counter(r["top1_label"] for r in rows if r["top1_label"] != "-")
    return {
        "n_requests": len(rows) + len(invalid),
        "n_replayed": len(rows),
        "n_invalid": len(invalid),
        "status_counts": dict(status_counts),
        "top1_class_counts": dict(top1_counts.most_common()),
        "top1_prob": _num_summary([r["top1_prob"] for r in rows]),
        "top1_prob_values": [r["top1_prob"] for r in rows if r["top1_prob"] is not None],
        "frames": _num_summary([float(r["frames"]) for r in rows]),
        "used_frames": _num_summary(
            [float(r["used_frames"]) for r in rows if r["used_frames"] is not None]
        ),
        "approx_fps": _num_summary([r["approx_fps"] for r in rows]),
        "hand_present_ratio": _num_summary([r["hand_ratio"] for r in rows]),
        "shoulder_vis_mean": _num_summary([r["shoulder_vis"] for r in rows]),
        "shoulder_width_scale": _num_summary([r["shoulder_scale"] for r in rows]),
        "hand_z_mean": _num_summary([r["hand_z_mean"] for r in rows]),
        "resolutions": dict(Counter(r["resolution"] for r in rows)),
    }


def print_report(rows: list[dict[str, Any]], invalid: list[dict[str, Any]]) -> None:
    header = (
        f"{'sess':8} {'req':8} {'frm':>4} {'res':>9} {'fps':>5} {'hand%':>5} "
        f"{'shVis':>5} {'scale':>6} {'top-1':<14} {'top-3':<44} {'status':<11} issues"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        top1 = f"{r['top1_label']}({_fmt(r['top1_prob'])})" if r["top1_prob"] is not None else "-"
        print(
            f"{r['session'][:8]:8} {r['request_id'][:8]:8} {r['frames']:>4} "
            f"{r['resolution']:>9} {_fmt(r['approx_fps'], '.1f'):>5} "
            f"{_fmt(r['hand_ratio']):>5} {_fmt(r['shoulder_vis']):>5} "
            f"{_fmt(r['shoulder_scale'], '.3f'):>6} {top1:<14} {r['top3']:<44} "
            f"{r['status']:<11} {r['issues']}"
        )
    for r in invalid:
        print(
            f"{r['session'][:8]:8} {r['request_id'][:8]:8} {'-':>4} {'-':>9} {'-':>5} "
            f"{'-':>5} {'-':>5} {'-':>6} {'-':<14} {'-':<44} {'invalid_422':<11} {r['error']}"
        )

    agg = aggregate(rows, invalid)
    print()
    print(
        f"== 집계 (요청 {agg['n_requests']}건: 재생 {agg['n_replayed']} / 검증불가 {agg['n_invalid']})"
    )
    print(f"status: {agg['status_counts']}")
    print("top-1 confidence 분포 (재생분):")
    print(_hist_text(agg["top1_prob_values"]))
    print(f"top-1 클래스 등장 횟수: {agg['top1_class_counts']}")
    for key, label in [
        ("frames", "프레임 수"),
        ("used_frames", "트리밍 후 프레임 수"),
        ("approx_fps", "추정 fps"),
        ("hand_present_ratio", "손 검출율"),
        ("shoulder_vis_mean", "어깨 visibility 평균"),
        ("shoulder_width_scale", "어깨 너비 scale"),
        ("hand_z_mean", "정규화 후 손 z 평균"),
    ]:
        s = agg[key]
        if s is None:
            print(f"{label}: -")
        else:
            print(
                f"{label}: mean={s['mean']:.3f} median={s['median']:.3f} "
                f"min={s['min']:.3f} max={s['max']:.3f} (n={s['n']})"
            )
    print(f"해상도: {agg['resolutions']}")


# ---------------------------------------------------------------- 메인
def iter_archive_files(
    archive_dir: Path, sessions: list[str], excludes: list[str]
) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for session_dir in sorted(p for p in archive_dir.iterdir() if p.is_dir()):
        name = session_dir.name
        if sessions and not any(name.startswith(s) for s in sessions):
            continue
        if any(name.startswith(e) for e in excludes):
            continue
        for f in sorted(session_dir.glob("*.json.gz"), key=lambda p: p.stat().st_mtime):
            out.append((name, f))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-dir", default=None, help="기본: {package_root}/var/archive")
    parser.add_argument(
        "--session", action="append", default=[], help="세션 prefix 필터 (반복 가능)"
    )
    parser.add_argument(
        "--exclude", action="append", default=[], help="세션 prefix 제외 (반복 가능)"
    )
    parser.add_argument("--json", action="store_true", help="요약을 JSON 으로 출력")
    parser.add_argument(
        "--no-write", action="store_true", help="진단 레코드(var/diagnostics/replay) 저장 생략"
    )
    args = parser.parse_args()

    archive_dir = (
        Path(args.archive_dir) if args.archive_dir else settings.package_root / settings.archive_dir
    )
    if not archive_dir.is_dir():
        print(f"아카이브 디렉토리가 없다: {archive_dir}", file=sys.stderr)
        return 1

    state = get_model_state()
    if not state.loaded:
        print(f"모델 로드 실패 — 재생 불가: {state.error}", file=sys.stderr)
        return 1

    rows: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    for session, path in iter_archive_files(archive_dir, args.session, args.exclude):
        request_id = path.name.removesuffix(".json.gz")
        try:
            payload = json.loads(gzip.decompress(path.read_bytes()))
            request = RecognizeRequest.model_validate(payload)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            invalid.append(
                {"session": session, "request_id": request_id, "error": f"본문 파싱 실패: {exc}"}
            )
            continue
        except ValidationError as exc:
            first = exc.errors()[0]
            loc = ".".join(str(p) for p in first.get("loc", []))
            invalid.append(
                {
                    "session": session,
                    "request_id": request_id,
                    "error": f"{loc}: {first.get('msg', '?')} (총 {exc.error_count()}건)",
                }
            )
            continue

        record = replay_one(request)
        if not args.no_write:
            write_diagnostics_record(record, subdir="replay")
        rows.append(_row_from_record(session, request_id, record))

    if args.json:
        agg = aggregate(rows, invalid)
        agg.pop("top1_prob_values", None)
        print(
            json.dumps(
                {"rows": rows, "invalid": invalid, "aggregate": agg},
                ensure_ascii=False,
                indent=1,
            )
        )
    else:
        print_report(rows, invalid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
