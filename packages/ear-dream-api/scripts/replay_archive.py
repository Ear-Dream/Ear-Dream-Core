"""아카이브(`var/archive/`) 재생 분석 — 저장된 /recognize 요청을 서버 파이프라인에
오프라인으로 태워 진단 레코드(app/services/diagnostics 와 동일 형식)를 만들고,
요약 테이블을 stdout 에 출력한다.

사용:
    uv run python scripts/replay_archive.py                      # 전체
    uv run python scripts/replay_archive.py --session 173fab2d   # 세션 prefix 필터 (반복 가능)
    uv run python scripts/replay_archive.py --exclude e2e-       # 세션 prefix 제외 (반복 가능)
    uv run python scripts/replay_archive.py --json               # 기계 판독용 JSON 출력
    uv run python scripts/replay_archive.py --no-write           # 진단 레코드 저장 생략

진단 레코드는 라이브 기록과 섞이지 않게 `var/diagnostics/replay/` 아래에 저장한다.
좌표 원본은 아카이브에 있으므로 레코드에는 요약 통계만 실린다.

재생마다 서버 파이프라인 구간(조립→전처리→추론)의 latency 를 실측해 행·집계에 싣는다 —
NFR-01 검토의 오프라인 참고 수치다 (HTTP 오버헤드 미포함이라 라이브 로그보다 짧다).

폴더/파일 패턴은 신형(`{MMDD_HHMM}_{sess8}/{seq:03d}_{req8}.json.gz`)과 구형
(`{session_id}/{request_id}.json.gz`) 모두 스캔한다 — 기존 var/ 데이터는 마이그레이션하지
않는다. 세션·요청 식별은 파일명이 아니라 **JSON 내용의 session_id/request_id** 에서 읽는다
(파일명은 축약이라 정본이 아니다). --session/--exclude 필터는 폴더명 전체와 sess8 토큰
양쪽에 prefix 매칭한다.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
import time
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
from app.ml.preprocess_spoter import PREPROCESS_VERSION, preprocess_spoter
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
    started = time.perf_counter()
    kp, assembly_meta = assemble_frames(request.segment.frames, settings.pose_visibility_threshold)
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
        pp = preprocess_spoter(frames, kp)
        probs = state.predict_probs(pp.x)
        order = np.argsort(probs)[::-1][: settings.recognize_top_k]
        best = float(probs[order[0]])
        if best < state.reject_threshold:
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
                used_start_ms=frames[0].t_ms,
                used_end_ms=frames[-1].t_ms,
                used_frame_count=pp.model_frame_count,
                interpolated_frame_count=0,  # spoter 계약: 보간 없음
                preprocess_version=PREPROCESS_VERSION,
            ),
            model_version=state.model_version,
            vocab_version=VOCAB_VERSION,
        )
    latency_ms = (time.perf_counter() - started) * 1000.0

    return build_recognize_diagnostics(
        request,
        kp,
        result,
        assembly_meta=assembly_meta,
        pp=pp,
        probs=probs,
        latency_ms=latency_ms,
    )


# ---------------------------------------------------------------- 행/집계
def _row_from_record(session: str, request_id: str, rec: dict[str, Any]) -> dict[str, Any]:
    req, asm = rec["request"], rec["assembly"]
    mo = rec.get("model_output")
    top3 = "-"
    top1_label, top1_prob = "-", None
    if mo is not None:
        sm = mo["softmax_top"]
        top1_label, top1_prob = sm[0]["label"], sm[0]["prob"]
        top3 = " ".join(f"{e['label']}({e['prob']:.2f})" for e in sm[:3])
    pre = rec.get("preprocess") or {}
    rates = pre.get("part_detection_rates") or {}
    resample = pre.get("resample") or {}
    return {
        "session": session,
        "request_id": request_id,
        "frames": req["frame_count"],
        "resolution": f"{req['source_width']}x{req['source_height']}",
        "approx_fps": req.get("approx_fps"),
        "hand_ratio": asm.get("hand_present_ratio"),
        "shoulder_vis": (asm.get("shoulder_visibility") or {}).get("mean"),
        "pose_rate": rates.get("pose"),
        "face_rate": rates.get("face"),
        "model_frames": resample.get("model_frame_count"),
        "top1_label": top1_label,
        "top1_prob": top1_prob,
        "top3": top3,
        "status": rec["response"]["status"],
        "issues": ",".join(rec["response"]["quality_issues"]) or "-",
        "latency_ms": (rec.get("response") or {}).get("latency_ms"),
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
        "model_frames": _num_summary(
            [float(r["model_frames"]) for r in rows if r["model_frames"] is not None]
        ),
        "approx_fps": _num_summary([r["approx_fps"] for r in rows]),
        "hand_present_ratio": _num_summary([r["hand_ratio"] for r in rows]),
        "shoulder_vis_mean": _num_summary([r["shoulder_vis"] for r in rows]),
        "pose_detection_rate": _num_summary([r["pose_rate"] for r in rows]),
        "face_detection_rate": _num_summary([r["face_rate"] for r in rows]),
        "latency_ms": _num_summary([r["latency_ms"] for r in rows]),
        "resolutions": dict(Counter(r["resolution"] for r in rows)),
    }


def print_report(rows: list[dict[str, Any]], invalid: list[dict[str, Any]]) -> None:
    header = (
        f"{'sess':8} {'req':8} {'frm':>4} {'res':>9} {'fps':>5} {'hand%':>5} "
        f"{'pose%':>5} {'mdlT':>4} {'ms':>6} {'top-1':<14} {'top-3':<44} {'status':<11} issues"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        top1 = f"{r['top1_label']}({_fmt(r['top1_prob'])})" if r["top1_prob"] is not None else "-"
        print(
            f"{r['session'][:8]:8} {r['request_id'][:8]:8} {r['frames']:>4} "
            f"{r['resolution']:>9} {_fmt(r['approx_fps'], '.1f'):>5} "
            f"{_fmt(r['hand_ratio']):>5} {_fmt(r['pose_rate']):>5} "
            f"{_fmt(r['model_frames']):>4} "
            f"{_fmt(r['latency_ms'], '.1f'):>6} {top1:<14} {r['top3']:<44} "
            f"{r['status']:<11} {r['issues']}"
        )
    for r in invalid:
        print(
            f"{r['session'][:8]:8} {r['request_id'][:8]:8} {'-':>4} {'-':>9} {'-':>5} "
            f"{'-':>5} {'-':>5} {'-':>4} {'-':>6} {'-':<14} {'-':<44} "
            f"{'invalid_422':<11} {r['error']}"
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
        ("model_frames", "모델 입력 프레임 수 (30fps 리샘플 후)"),
        ("approx_fps", "추정 fps"),
        ("hand_present_ratio", "손 검출율"),
        ("shoulder_vis_mean", "어깨 visibility 평균"),
        ("pose_detection_rate", "pose 검출율 (전처리)"),
        ("face_detection_rate", "face 검출율 (전처리)"),
        ("latency_ms", "파이프라인 latency (ms, HTTP 미포함)"),
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
def _session_token(dirname: str) -> str:
    """폴더명에서 세션 토큰을 뽑는다 — 신형 `{MMDD_HHMM}_{sess8}` 은 시각 접두를 뗀
    sess8, 구형(`{session_id}`)은 폴더명 전체."""
    parts = dirname.split("_")
    if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit():
        return "_".join(parts[2:])
    return dirname


def _dir_matches(dirname: str, prefix: str) -> bool:
    """--session/--exclude prefix 매칭 — 폴더명 전체와 sess8 토큰 양쪽에 적용해
    신·구 패턴 모두에서 같은 필터가 통한다."""
    return dirname.startswith(prefix) or _session_token(dirname).startswith(prefix)


def iter_archive_files(
    archive_dir: Path, sessions: list[str], excludes: list[str]
) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    for session_dir in sorted(p for p in archive_dir.iterdir() if p.is_dir()):
        name = session_dir.name
        if sessions and not any(_dir_matches(name, s) for s in sessions):
            continue
        if any(_dir_matches(name, e) for e in excludes):
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
        # 파일명은 축약(seq_req8)이라 정본이 아니다 — 식별자는 JSON 내용에서 읽고,
        # 본문이 JSON 조차 아닐 때만 폴더/파일명을 fallback 으로 쓴다.
        request_id = path.name.removesuffix(".json.gz")
        try:
            payload = json.loads(gzip.decompress(path.read_bytes()))
            if isinstance(payload, dict):
                if isinstance(payload.get("session_id"), str):
                    session = payload["session_id"]
                if isinstance(payload.get("request_id"), str):
                    request_id = payload["request_id"]
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
