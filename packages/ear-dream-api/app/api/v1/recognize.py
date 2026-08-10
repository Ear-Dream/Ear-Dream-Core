"""/recognize — 수어 세그먼트 하나를 단어 후보 top-k 로 인식한다.

라우트는 얇게 유지한다: 조립·전처리·추론은 app/ml, 아카이빙은 app/services 소관.
응답 시간은 반드시 로깅한다 — NFR-01(허용 지연 시간) 확정의 유일한 근거 데이터다.
(latency_ms 필드를 포함한 한 줄 처리 로그로 통합돼 있다 — 지우지 말 것.)
"""

from __future__ import annotations

import time
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

import numpy as np
from fastapi import Body, HTTPException, Request, Response
from fastapi.routing import APIRoute, APIRouter

from app.core.config import settings
from app.core.logging import get_logger
from app.examples import recognize_openapi_examples
from app.ml.assembly import assemble_frames
from app.ml.keypoint_layout import L_SHOULDER, LEFT_HAND, R_SHOULDER, RIGHT_HAND
from app.ml.model import get_model_state
from app.ml.preprocess import (
    MIN_TRIM_LEN,
    PREPROCESS_VERSION,
    preprocess_eval,
    trim_rest_bounds,
)
from app.ml.vocab import VOCAB_VERSION
from app.schemas.recognition import (
    PreprocessInfo,
    QualityIssue,
    RecognitionResult,
    RecognitionStatus,
    RecognizeRequest,
    SignCandidate,
)
from app.services.archive import archive_recognize_body
from app.services.diagnostics import record_recognize_diagnostics

logger = get_logger("recognize")


class ArchivingRoute(APIRoute):
    """Pydantic 검증 **이전**에 raw body 를 아카이빙하는 라우트.

    검증 실패(422) 요청도 데이터셋 후보로 보관해야 하므로 핸들러 안이 아니라 여기서 저장한다.
    request.body() 는 같은 Request 인스턴스에 캐시되므로 다운스트림 검증이 다시 읽을 수 있다.
    아카이빙 결과(경로·파싱된 id)는 request.state 로 핸들러와 422 로그에 전달한다.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            request.state.archive_info = archive_recognize_body(await request.body())
            return await original(request)

        return handler


router = APIRouter(tags=["recognize"], route_class=ArchivingRoute)


# hand_partially_out 어드바이저리 판정 비율: 트리밍 후 구간에서 손이 잡힌 프레임 비율이
# 이보다 낮으면 참고용으로 첨부한다. ⚠️ 임시값 — 실사용 데이터로 검증되지 않은 프로토타입 기준.
HAND_PRESENT_RATIO_ADVISORY = 0.5


def _quality_issues(kp: np.ndarray) -> tuple[list[QualityIssue], list[QualityIssue]]:
    """조립된 (T, 130, 3) 배열 기준 품질 검사. 반환: (blocking, advisory).

    - blocking: 추론이 무의미해 건너뛰는 조건 (no_hand_detected, too_few_valid_frames).
      low_quality + 빈 candidates 로 응답한다.
    - advisory: 추론은 정상 진행하고 결과(recognized/rejected)에 참고용으로만 첨부하는
      조건. 한 손으로 폰을 들고 쓰면 손이 프레임 밖에 있다가 들어오는 것이 정상 사용
      패턴이고, 결측은 전처리가 처리하도록 설계돼 있다 — 앞뒤 결측은 trim_rest,
      어깨 결측은 normalize_signer 의 fallback(유효 프레임 중앙값 → 극단 케이스 고정값),
      구간 내 결측은 선형 보간. 클라이언트는 advisory 를 안내 문구로만 쓴다.
    """
    blocking: list[QualityIssue] = []
    advisory: list[QualityIssue] = []

    hand_present = ~np.isnan(kp[:, LEFT_HAND + RIGHT_HAND, :]).all(axis=(1, 2))  # (T,)
    if not hand_present.any():
        blocking.append(QualityIssue.no_hand_detected)
    elif int(hand_present.sum()) < MIN_TRIM_LEN:
        # 손이 잡힌 프레임이 전처리 최소 트리밍 길이보다 적으면 인식이 무의미하다
        blocking.append(QualityIssue.too_few_valid_frames)
    else:
        # 트리밍 후 구간 내에서 손 프레임 비율이 낮으면 중간 결측(보간 구간)이 많다는 뜻.
        # 추론은 진행하되 참고용으로 첨부한다.
        start, end = trim_rest_bounds(kp)
        seg = hand_present[start:end]
        if seg.size and float(seg.mean()) < HAND_PRESENT_RATIO_ADVISORY:
            advisory.append(QualityIssue.hand_partially_out)

    shoulders_ok = ~(
        np.isnan(kp[:, L_SHOULDER, :]).any(axis=1) | np.isnan(kp[:, R_SHOULDER, :]).any(axis=1)
    )
    if not shoulders_ok.any():
        # 양어깨가 한 프레임도 안 잡히면 normalize_signer 가 고정 fallback 으로 동작한다.
        # 예측 신뢰도가 떨어질 수 있으나 추론은 진행한다. 어깨가 일부 프레임에서만 잡히는
        # 경우는 중앙값 fallback 이 처리하므로 이슈로 치지 않는다.
        advisory.append(QualityIssue.shoulders_not_visible)

    return blocking, advisory


def _archive_path_str(raw_request: Request) -> str:
    """로그용 아카이브 경로. 비활성/실패면 '-'.

    **절대경로**로 남긴다 — VS Code 터미널이 자동 링크화해서 로그에서 바로 열린다.
    한 줄이 길어지므로 로그의 마지막 필드(archive=/diag=)에만 쓴다.
    """
    info = getattr(raw_request.state, "archive_info", None)
    if info is None or info.path is None:
        return "-"
    return str(info.path)


@router.post("/recognize", response_model=RecognitionResult)
def recognize(
    request: Annotated[RecognizeRequest, Body(openapi_examples=recognize_openapi_examples())],
    raw_request: Request,
) -> RecognitionResult:
    started = time.perf_counter()
    # 요청 처리 로그(한 줄) 필드. 좌표 데이터는 절대 싣지 않는다.
    log: dict[str, Any] = {
        "req": request.request_id,
        "sess": request.session_id,
        "frames_in": len(request.segment.frames),
        "frames_used": "-",  # 트리밍 후 프레임 수
        "interp": "-",  # 보간이 개입한 프레임 수
        "status": "error",
        "top1": "-",
        "issues": [],
    }
    # 진단 레코드 재료 (finally 에서 기록) — 결과가 만들어진 경로에서만 채워진다
    kp: np.ndarray | None = None
    pp = None
    probs: np.ndarray | None = None
    result: RecognitionResult | None = None
    try:
        state = get_model_state()
        if not state.loaded:
            log["status"] = "http503_model_not_loaded"
            raise HTTPException(status_code=503, detail="recognition model is not loaded")

        frames = request.segment.frames
        kp = assemble_frames(frames, settings.pose_visibility_threshold)

        blocking, advisory = _quality_issues(kp)
        if blocking:
            log["status"] = RecognitionStatus.low_quality.value
            log["issues"] = [i.value for i in blocking + advisory]
            result = RecognitionResult(
                request_id=request.request_id,
                status=RecognitionStatus.low_quality,
                candidates=[],
                quality_issues=blocking + advisory,
                preprocess=None,
                model_version=state.model_version,
                vocab_version=VOCAB_VERSION,
            )
            return result

        # v2 등방 정규화의 AR 은 요청의 실측 해상도에서 온다 (핸드오프 §3-1).
        # use_z 는 체크포인트 계약(state.use_z)에서 온다 — 라우트가 정하지 않는다.
        capture = request.segment.capture
        aspect_ratio = capture.source_width / capture.source_height
        pp = preprocess_eval(kp, aspect_ratio=aspect_ratio, use_z=state.use_z)
        log["frames_used"] = pp.used_frame_count
        log["interp"] = pp.interpolated_frame_count
        probs = state.predict_probs(pp.x)

        # top-k (개수는 미확정 임시값 — settings.recognize_top_k)
        # 클래스 인덱스 → 어휘는 로드 시 검증된 체크포인트 class_labels(state.class_entries)
        order = np.argsort(probs)[::-1][: settings.recognize_top_k]
        best = float(probs[order[0]])
        best_entry = state.class_entries[order[0]]
        log["top1"] = f"{best_entry.label}({best:.3f})"

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

        log["status"] = status.value
        log["issues"] = [i.value for i in advisory]
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
        return result
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        # 진단 레코드 기록 (베스트 에포트 — 실패해도 응답을 막지 않는다)
        diag_path = "-"
        if result is not None and kp is not None:
            written = record_recognize_diagnostics(
                request,
                kp,
                result,
                pp=pp,
                probs=probs,
                latency_ms=elapsed_ms,
                # 아카이브와 같은 세션 폴더명·seq 를 쓰게 한다 (파일명 접두로 조인)
                archive_info=getattr(raw_request.state, "archive_info", None),
            )
            if written is not None:
                # 절대경로 — VS Code 터미널 자동 링크화용 (마지막 필드라 줄이 길어도 된다)
                diag_path = str(written)
        # NFR-01(허용 지연 시간) 확정 근거 — latency_ms 필드는 반드시 남긴다
        logger.info(
            "recognize req=%s sess=%s frames=%s→%s interp=%s status=%s top1=%s "
            "issues=[%s] latency_ms=%.1f archive=%s diag=%s",
            log["req"],
            log["sess"],
            log["frames_in"],
            log["frames_used"],
            log["interp"],
            log["status"],
            log["top1"],
            ",".join(log["issues"]),
            elapsed_ms,
            _archive_path_str(raw_request),
            diag_path,
        )
