/**
 * `POST /api/v1/sign-sequence` 호출 + 빌트인 좌표 로딩.
 *
 * 서버는 **재생 지시**만 준다(순서 · 자산 키 · 불가 사유). 좌표는 앱에 실려 있으므로
 * 응답을 받은 뒤 필요한 단어의 자산만 읽는다.
 *
 * 취소·늦은 응답 처리는 `features/recognition/api/useSentenceComposer` 와 같은 방식이다 —
 * 진행 중 요청은 abort 하고, 응답의 request_id 를 대조해 늦게 온 것은 버린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SignSequenceItem, SignSequenceResult } from '@ear-dream/core';

import { api } from '../../../api';
import { RECOGNIZE_TIMEOUT_MS } from '../../recognition/api/config';
import { createRequestId } from '../../recognition/api/createRequestId';
import { isAbortError } from '../../recognition/api/isAbortError';
import { loadManifest, loadSequence, type SignSequence } from './sequenceAssets';

export type SignSequencePhase =
  | { name: 'idle' }
  | { name: 'pending' }
  /** 서버 응답과 좌표가 모두 준비됐다. 재생 가능한 것이 하나도 없을 수도 있다. */
  | { name: 'ready'; result: SignSequenceResult; sequences: SignSequence[] }
  /** 서버에 닿지 못했다. 단어를 못 알아들은 것과 다르다 — 재시도가 의미 있다. */
  | { name: 'failed' };

export interface UseSignSequenceResult {
  phase: SignSequencePhase;
  /** 자산 번들과 서버가 서로 다른 판을 보고 있다. 조용히 틀린 걸 재생하면 안 된다. */
  bundleMismatch: boolean;
  request: (text: string) => void;
  retry: () => void;
}

export function useSignSequence(sessionId: string): UseSignSequenceResult {
  const [phase, setPhase] = useState<SignSequencePhase>({ name: 'idle' });
  const [bundleMismatch, setBundleMismatch] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const lastTextRef = useRef<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastTextRef.current = text;
      const owns = () => controllerRef.current === controller;

      setPhase({ name: 'pending' });
      const requestId = createRequestId();
      const timeout = setTimeout(() => {
        if (owns()) controller.abort();
      }, RECOGNIZE_TIMEOUT_MS);

      try {
        const { data, response } = await api.POST('/api/v1/sign-sequence', {
          body: { session_id: sessionId, request_id: requestId, text },
          signal: controller.signal,
        });
        if (!owns()) return;
        if (!response.ok || !data) {
          setPhase({ name: 'failed' });
          return;
        }

        const manifest = await loadManifest();
        if (!owns()) return;
        if (!manifest) {
          // 자산이 없다(생성 안 함 / 빌드 누락). 서버는 멀쩡하니 failed 가 아니라
          // ready 로 두고, 화면이 "재생할 자산이 없다"로 안내하게 한다.
          setPhase({ name: 'ready', result: data, sequences: [] });
          return;
        }

        setBundleMismatch(
          Boolean(data.sequence_bundle_version) &&
            data.sequence_bundle_version !== manifest.bundleVersion,
        );

        const keys = data.items
          .map((item: SignSequenceItem) => item.sequence_key)
          .filter((key): key is string => Boolean(key));
        const loaded = await Promise.all(
          keys.map((key) => loadSequence(key, manifest.format)),
        );
        if (!owns()) return;

        setPhase({
          name: 'ready',
          result: data,
          sequences: loaded.filter((s): s is SignSequence => s !== null),
        });
      } catch (cause) {
        if (!owns()) return;
        if (isAbortError(cause)) {
          setPhase({ name: 'failed' });
          return;
        }
        setPhase({ name: 'failed' });
      } finally {
        clearTimeout(timeout);
      }
    },
    [sessionId],
  );

  const request = useCallback((text: string) => void send(text), [send]);
  const retry = useCallback(() => {
    if (lastTextRef.current) void send(lastTextRef.current);
  }, [send]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  return { phase, bundleMismatch, request, retry };
}
