/**
 * /api/v1/recognize 호출 큐 훅 — pill 큐(태그 입력) UX 재구성 (2026-08-10 사용자 확정).
 *
 * 이전 useRecognizer 는 단일 비행(새 요청이 이전을 abort)이었다. 이 훅은 **엔트리별 독립
 * 요청**을 허용한다: 버튼 릴리즈마다 대기(pending) 엔트리가 큐 끝에 붙고, 요청은 병렬로
 * 나가되 **순서는 큐(배열 순서)가 보존**한다. 응답은 localId 로 자기 엔트리만 갱신하므로
 * 늦게 도착해도 순서가 섞이지 않는다.
 *
 * 상태 설계에서 가장 중요한 구분(useRecognizer 에서 유지):
 *   - **인식 실패가 아닌 것** — 503(모델 미로드) · 네트워크 실패 · 타임아웃 · 비정상 응답.
 *     세그먼트는 유효하므로 엔트리를 failed 로 보존하고 pill 탭으로 **재전송**한다.
 *   - **인식 실패** — 응답 status 가 rejected / low_quality. HTTP 200 정상 응답이며,
 *     해당 pill 을 제거하고 인라인 배너(notice)로 "다시 동작" 을 안내한다.
 * 이 둘을 섞으면 "서버가 죽었는데 동작을 다시 하라"거나 "동작이 문제인데 재전송"하는
 * 잘못된 안내가 나온다.
 *
 * 늦은 응답 처리: 엔트리별 AbortController 를 inflight 맵으로 소유 대조한다 — 엔트리가
 * 제거되었거나 재전송으로 새 controller 가 소유권을 가져갔으면 그 응답은 조용히 폐기한다.
 * 응답 본문의 request_id 도 대조한다(프록시 캐시 등으로 다른 요청의 응답이 흘러드는 경우).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { RecognitionResult, SignSegment } from '@ear-dream/core';

import { api } from '../../../api';
import { RECOGNIZE_TIMEOUT_MS } from './config';
import { createRequestId } from './createRequestId';
import { isAbortError } from './isAbortError';

/** 재전송 가능한 실패 종류. 인식 실패(rejected/low_quality)는 여기 속하지 않는다. */
export type RecognizerFailureKind =
  /** 503 — 서버는 살아 있지만 모델이 아직 로드되지 않았다. */
  | 'model_unavailable'
  /** fetch 자체가 실패 (오프라인, 서버 다운 등). */
  | 'network'
  /** 그 외 비정상 응답 (422 계약 위반 = 앱 버그, 5xx, request_id 불일치 등). */
  | 'server'
  /** RECOGNIZE_TIMEOUT_MS 안에 응답이 없어 요청을 끊었다. 세그먼트는 보존 — 재전송 가능. */
  | 'timeout';

/**
 * 큐 엔트리 하나 = pill 하나. 배열 순서가 곧 문장 내 단어 순서다.
 *
 * done 엔트리는 RecognitionResult **전체**를 보존한다 — top-k 후보를 하단 시트에서
 * 다시 보여주고 교체(chosenCandidateIndex)할 수 있어야 해서다. 자동 확정은 top-1
 * (index 0)이고, 교체는 인덱스만 바꾼다.
 */
export type RecognitionEntry =
  | { localId: string; requestId: string; state: 'pending' }
  | {
      localId: string;
      requestId: string;
      state: 'done';
      result: RecognitionResult;
      chosenCandidateIndex: number;
    }
  | { localId: string; requestId: string; state: 'failed'; kind: RecognizerFailureKind };

/**
 * 인라인 배너 안내. pill 이 표현하지 못하는 "왜" 를 전달한다.
 *   - result: rejected/low_quality — 해당 pill 은 이미 제거됐다. "다시 동작" 안내.
 *   - failure: 전송 실패 — pill 은 failed 로 남아 있다. 실패 이유 안내(조작은 pill 몫).
 */
export type QueueNotice =
  | { kind: 'result'; result: RecognitionResult }
  | { kind: 'failure'; failure: RecognizerFailureKind };

export interface UseRecognitionQueueResult {
  /** pill 큐. 배열 순서 = 단어 순서. */
  entries: readonly RecognitionEntry[];
  /** 세그먼트를 전송한다 — 큐 끝에 pending 엔트리를 붙이고 즉시(병렬) 요청을 보낸다. */
  submit: (segment: SignSegment) => void;
  /** failed 엔트리를 재전송한다. request_id 를 유지한다(멱등·추적용). */
  retry: (localId: string) => void;
  /** 엔트리 제거. pending 이면 요청도 abort 한다(이전 UX 의 "취소" 대체). */
  remove: (localId: string) => void;
  /** done 엔트리의 확정 후보를 top-k 안에서 교체한다. */
  chooseCandidate: (localId: string, index: number) => void;
  /** 인라인 배너 상태. 소비(자동 소멸 타이머 포함)는 화면 몫이다. */
  notice: QueueNotice | null;
  dismissNotice: () => void;
}

export function useRecognitionQueue(sessionId: string): UseRecognitionQueueResult {
  const [entries, setEntries] = useState<RecognitionEntry[]>([]);
  const [notice, setNotice] = useState<QueueNotice | null>(null);

  // 진행 중 요청의 소유권 대장. localId → 그 엔트리의 현재 요청 controller.
  // 응답/타임아웃 콜백은 자기 controller 가 아직 대장에 있는지로 유효성을 판별한다.
  const inflightRef = useRef(new Map<string, AbortController>());
  // 재전송용으로 보존하는 세그먼트. request_id 를 함께 보존해 멱등 재전송이 되게 한다.
  const attemptsRef = useRef(new Map<string, { segment: SignSegment; requestId: string }>());

  const send = useCallback(
    async (localId: string, requestId: string, segment: SignSegment) => {
      const controller = new AbortController();
      inflightRef.current.set(localId, controller);

      /** 이 콜백이 아직 이 엔트리의 현재 요청인가 (제거·재전송으로 소유권 상실 검사). */
      const owns = () => inflightRef.current.get(localId) === controller;

      const settleFailed = (kind: RecognizerFailureKind) => {
        inflightRef.current.delete(localId);
        setEntries((prev) =>
          prev.map((entry) =>
            entry.localId === localId ? { localId, requestId, state: 'failed', kind } : entry,
          ),
        );
        setNotice({ kind: 'failure', failure: kind });
      };

      // 응답이 영영 오지 않는 경우(서버 재시작 창 등)의 pending 무한 대기 방지.
      // failed 전이를 먼저 하고 abort 한다 — abort 로 깨어난 catch 는 소유권 검사에서
      // 걸러지므로 여기서 정한 timeout 상태가 유지된다.
      const timeoutTimer = setTimeout(() => {
        if (!owns()) return;
        settleFailed('timeout');
        controller.abort();
      }, RECOGNIZE_TIMEOUT_MS);

      try {
        const { data, response } = await api.POST('/api/v1/recognize', {
          body: { session_id: sessionId, request_id: requestId, segment },
          signal: controller.signal,
        });

        if (!owns()) return;

        if (data) {
          // 응답 본문의 request_id 대조 — 다른 요청의 응답이 흘러들어온 비정상 케이스.
          // 조용히 버리면 pending 에 갇히므로 실패로 전이해 재전송(pill 탭) 경로를 연다.
          // recognized 인데 후보가 비어 있는 것도 계약 위반이라 같은 취급이다
          // (top-1 자동 확정이 불가능하다).
          if (data.request_id !== requestId || (data.status === 'recognized' && data.candidates.length === 0)) {
            settleFailed('server');
            return;
          }

          inflightRef.current.delete(localId);
          if (data.status === 'recognized') {
            // top-1 자동 확정 — 화면 전환 없이 pill 이 단어로 바뀐다. 정정은 pill 탭(시트).
            setEntries((prev) =>
              prev.map((entry) =>
                entry.localId === localId
                  ? { localId, requestId, state: 'done', result: data, chosenCandidateIndex: 0 }
                  : entry,
              ),
            );
          } else {
            // rejected/low_quality — 인식 실패. pill 을 제거하고 배너로 "다시 동작" 안내.
            attemptsRef.current.delete(localId);
            setEntries((prev) => prev.filter((entry) => entry.localId !== localId));
            setNotice({ kind: 'result', result: data });
          }
          return;
        }

        settleFailed(response.status === 503 ? 'model_unavailable' : 'server');
      } catch (cause) {
        if (!owns()) return;
        if (isAbortError(cause)) return;
        settleFailed('network');
      } finally {
        // 정상 완료·에러·취소(abort 로 인한 reject) 모두 여기로 온다 — 타이머 정리.
        clearTimeout(timeoutTimer);
      }
    },
    [sessionId],
  );

  const submit = useCallback(
    (segment: SignSegment) => {
      const localId = createRequestId();
      const requestId = createRequestId();
      attemptsRef.current.set(localId, { segment, requestId });
      setEntries((prev) => [...prev, { localId, requestId, state: 'pending' }]);
      void send(localId, requestId, segment);
    },
    [send],
  );

  const retry = useCallback(
    (localId: string) => {
      const attempt = attemptsRef.current.get(localId);
      if (!attempt) return;
      setEntries((prev) =>
        prev.map((entry) =>
          entry.localId === localId && entry.state === 'failed'
            ? { localId, requestId: attempt.requestId, state: 'pending' }
            : entry,
        ),
      );
      // 재전송을 시작했으니 그 실패를 알리던 배너는 걷는다 (다른 종류 배너는 유지).
      setNotice((prev) => (prev?.kind === 'failure' ? null : prev));
      void send(localId, attempt.requestId, attempt.segment);
    },
    [send],
  );

  const remove = useCallback((localId: string) => {
    inflightRef.current.get(localId)?.abort();
    inflightRef.current.delete(localId);
    attemptsRef.current.delete(localId);
    setEntries((prev) => prev.filter((entry) => entry.localId !== localId));
  }, []);

  const chooseCandidate = useCallback((localId: string, index: number) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.localId === localId &&
        entry.state === 'done' &&
        index >= 0 &&
        index < entry.result.candidates.length
          ? { ...entry, chosenCandidateIndex: index }
          : entry,
      ),
    );
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // 언마운트 시 진행 중 요청을 전부 끊는다.
  useEffect(() => {
    const inflight = inflightRef.current;
    return () => {
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    };
  }, []);

  return { entries, submit, retry, remove, chooseCandidate, notice, dismissNotice };
}

/** done 엔트리의 현재 확정 후보. chosenCandidateIndex 는 chooseCandidate 가 범위를 보장한다. */
export function chosenCandidate(entry: Extract<RecognitionEntry, { state: 'done' }>) {
  return entry.result.candidates[entry.chosenCandidateIndex] ?? entry.result.candidates[0];
}
