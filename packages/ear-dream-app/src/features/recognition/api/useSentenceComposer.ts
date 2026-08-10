/**
 * /api/v1/compose-sentence 호출 훅 — 누적 단어 열 → 문장 후보.
 *
 * useRecognizer 와 같은 원칙: 진행 중 요청은 AbortController 로 취소하고 응답의
 * request_id 를 대조해 늦은 응답을 폐기한다. 실패 시 단어 열은 호출한 쪽(SignFlow)이
 * 들고 있으므로 여기서는 재시도용 word_ids 만 보존한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SentenceResult } from '@ear-dream/core';

import { api } from '../../../api';
import { RECOGNIZE_TIMEOUT_MS } from './config';
import { createRequestId } from './createRequestId';
import { isAbortError } from './isAbortError';

export type ComposerPhase =
  | { name: 'idle' }
  | { name: 'pending'; requestId: string }
  | { name: 'done'; result: SentenceResult }
  /** 전송 실패 — 단어 열은 보존되어 있고 retry() 로 재시도할 수 있다. */
  | { name: 'failed' };

export interface ComposeInput {
  wordIds: string[];
  /** 각 단어를 만든 /recognize request_id (추적용, 선택). */
  sourceRequestIds?: string[];
}

export interface UseSentenceComposerResult {
  phase: ComposerPhase;
  compose: (input: ComposeInput) => void;
  /** 마지막 입력을 재전송한다. request_id 유지(멱등·추적용). */
  retry: () => void;
  cancel: () => void;
  reset: () => void;
}

export function useSentenceComposer(sessionId: string): UseSentenceComposerResult {
  const [phase, setPhase] = useState<ComposerPhase>({ name: 'idle' });

  const controllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const lastAttemptRef = useRef<{ input: ComposeInput; requestId: string } | null>(null);

  const send = useCallback(
    async (input: ComposeInput, requestId: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      currentRequestIdRef.current = requestId;
      lastAttemptRef.current = { input, requestId };
      setPhase({ name: 'pending', requestId });

      // useRecognizer 와 같은 pending 무한 대기 방지 — 상한 초과 시 abort 후 failed 전이.
      // failed 는 종류 구분이 없어 기존 재시도 UI(ResultScreen)로 그대로 흐른다.
      const timeoutTimer = setTimeout(() => {
        if (currentRequestIdRef.current !== requestId) return;
        controller.abort();
        setPhase({ name: 'failed' });
      }, RECOGNIZE_TIMEOUT_MS);

      try {
        const { data } = await api.POST('/api/v1/compose-sentence', {
          body: {
            session_id: sessionId,
            request_id: requestId,
            word_ids: input.wordIds,
            source_request_ids: input.sourceRequestIds ?? null,
          },
          signal: controller.signal,
        });

        if (currentRequestIdRef.current !== requestId) return;

        if (data && data.request_id === requestId) {
          setPhase({ name: 'done', result: data });
          return;
        }
        setPhase({ name: 'failed' });
      } catch (cause) {
        if (currentRequestIdRef.current !== requestId) return;
        if (isAbortError(cause)) return;
        setPhase({ name: 'failed' });
      } finally {
        // 정상 완료·에러·취소(abort 로 인한 reject) 모두 여기로 온다 — 타이머 정리.
        clearTimeout(timeoutTimer);
      }
    },
    [sessionId],
  );

  const compose = useCallback(
    (input: ComposeInput) => {
      void send(input, createRequestId());
    },
    [send],
  );

  const retry = useCallback(() => {
    const last = lastAttemptRef.current;
    if (!last) return;
    void send(last.input, last.requestId);
  }, [send]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    currentRequestIdRef.current = null;
    setPhase({ name: 'idle' });
  }, []);

  const reset = useCallback(() => {
    currentRequestIdRef.current = null;
    setPhase({ name: 'idle' });
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      currentRequestIdRef.current = null;
    };
  }, []);

  return { phase, compose, retry, cancel, reset };
}
