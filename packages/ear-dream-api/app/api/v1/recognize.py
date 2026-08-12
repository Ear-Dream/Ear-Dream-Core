"""/recognize — 수어 세그먼트 하나를 단어 후보 top-k 로 인식한다 (SPOTER-208, 300단어).

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
from app.ml.assembly import AssemblyMeta, assemble_frames
from app.ml.keypoint_layout import L_SHOULDER, LEFT_HAND, R_SHOULDER, RIGHT_HAND
from app.ml.model import get_model_state
from app.ml.preprocess_spoter import PREPROCESS_VERSION, preprocess_spoter
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


# hand_partially_out 어드바이저리 판정 비율: 세그먼트에서 손이 잡힌 프레임 비율이 이보다
# 낮으면 참고용으로 첨부한다. ⚠️ 임시값 — 실사용 데이터로 검증되지 않은 프로토타입 기준.
# (SPOTER 전처리는 trim 없이 전 구간을 쓰므로 v2 와 달리 전체 세그먼트 기준이다 —
#  결측 프레임은 보간 없이 0-채움되어 모델 입력에 그대로 남는다.)
HAND_PRESENT_RATIO_ADVISORY = 0.5


def _quality_issues(kp: np.ndarray) -> tuple[list[QualityIssue], list[QualityIssue]]:
    """조립된 (T, 130, 3) 배열 기준 품질 검사. 반환: (blocking, advisory).

    - blocking: 추론이 무의미해 건너뛰는 조건 (no_hand_detected, too_few_valid_frames).
      low_quality + 빈 candidates 로 응답한다.
    - advisory: 추론은 정상 진행하고 결과(recognized/rejected)에 참고용으로만 첨부.
      SPOTER 전처리는 부위 미검출을 0-채움으로 보존하므로(보간·트리밍 없음) 결측이
      많아도 추론 자체는 가능하다 — 클라이언트는 advisory 를 안내 문구로만 쓴다.
    """
    blocking: list[QualityIssue] = []
    advisory: list[QualityIssue] = []

    hand_present = ~np.isnan(kp[:, LEFT_HAND + RIGHT_HAND, :]).all(axis=(1, 2))  # (T,)
    if not hand_present.any():
        blocking.append(QualityIssue.no_hand_detected)
    elif int(hand_present.sum()) < settings.min_frames:
        # 손이 잡힌 프레임이 최소 세그먼트 길이(임시값)보다 적으면 인식이 무의미하다
        blocking.append(QualityIssue.too_few_valid_frames)
    elif float(hand_present.mean()) < HAND_PRESENT_RATIO_ADVISORY:
        # 손 프레임 비율이 낮으면 0-채움 결측 구간이 많다는 뜻 — 추론은 진행, 참고 첨부
        advisory.append(QualityIssue.hand_partially_out)

    shoulders_ok = ~(
        np.isnan(kp[:, L_SHOULDER, :]).any(axis=1) | np.isnan(kp[:, R_SHOULDER, :]).any(axis=1)
    )
    if not shoulders_ok.any():
        # 양어깨가 한 프레임도 안 잡히면 pose 부위가 전 구간 0-채움된다 (global 정규화가
        # 어깨 기준이라 pose 는 미검출 처리). 손 local 특징만으로 추론은 진행한다.
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
        "frames_used": "-",  # 30fps 리샘플(+256 캡) 후 모델 입력 프레임 수
        "status": "error",
        "top1": "-",
        "issues": [],
    }
    # 진단 레코드 재료 (finally 에서 기록) — 결과가 만들어진 경로에서만 채워진다
    kp: np.ndarray | None = None
    assembly_meta: AssemblyMeta | None = None
    pp = None
    probs: np.ndarray | None = None
    result: RecognitionResult | None = None
    try:
        state = get_model_state()
        if not state.loaded:
            log["status"] = "http503_model_not_loaded"
            raise HTTPException(status_code=503, detail="recognition model is not loaded")

        frames = request.segment.frames
        kp, assembly_meta = assemble_frames(frames, settings.pose_visibility_threshold)

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

        # 입력측 기하 보정 2종 (preprocess_spoter 모듈 docstring):
        #   x — AR 보정: 캡처 실측 해상도(CaptureMeta)로 학습 16:9 관례에 사영
        #   y — 원근 갭 보정: settings.live_y_scale (임시 상수 — config.py 주석)
        cap = request.segment.capture
        pp = preprocess_spoter(
            frames,
            kp,
            source_aspect=cap.source_width / cap.source_height,
            y_scale=settings.live_y_scale,
        )
        log["frames_used"] = pp.model_frame_count
        # probs 는 캘리브레이션 + 로짓 편향 제거 후 분포다 (app/ml/model docstring) —
        # 아래 confidence·reject 판정 전부 이 분포 기준이다
        probs = state.predict_probs(pp.x)

        # top-k (개수는 미확정 임시값 — settings.recognize_top_k)
        # 클래스 인덱스 → 어휘는 로드 시 검증된 release.json class_labels(state.class_entries)
        order = np.argsort(probs)[::-1][: settings.recognize_top_k]
        best = float(probs[order[0]])
        best_entry = state.class_entries[order[0]]
        log["top1"] = f"{best_entry.label}({best:.3f})"

        # reject 임계는 로드 시 확정된 값 (release.json 권장값 또는 설정 오버라이드)
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

        log["status"] = status.value
        log["issues"] = [i.value for i in advisory]
        result = RecognitionResult(
            request_id=request.request_id,
            status=status,
            candidates=candidates,
            quality_issues=advisory,
            preprocess=PreprocessInfo(
                # SPOTER 전처리는 트리밍이 없다 — 사용 구간 = 세그먼트 전체
                used_start_ms=frames[0].t_ms,
                used_end_ms=frames[-1].t_ms,
                # 모델 입력 프레임 수 (30fps 리샘플 + 256 캡 이후)
                used_frame_count=pp.model_frame_count,
                # 계약상 보간이 없다 (결측은 0-채움 보존) — 항상 0
                interpolated_frame_count=0,
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
        if result is not None and kp is not None and assembly_meta is not None:
            written = record_recognize_diagnostics(
                request,
                kp,
                result,
                assembly_meta=assembly_meta,
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
            "recognize req=%s sess=%s frames=%s→%s status=%s top1=%s "
            "issues=[%s] latency_ms=%.1f archive=%s diag=%s",
            log["req"],
            log["sess"],
            log["frames_in"],
            log["frames_used"],
            log["status"],
            log["top1"],
            ",".join(log["issues"]),
            elapsed_ms,
            _archive_path_str(raw_request),
            diag_path,
        )
