/**
 * 부팅 시 1회 로드하는 서버 카탈로그 — /api/v1/vocabulary + /api/v1/model.
 *
 * 실패해도 앱은 뜬다: 어휘·모델 정보는 안내 품질을 높이는 부가 정보이지 화면 진입의
 * 전제 조건이 아니다. 로드 실패 시 null 로 두고, 소비하는 쪽이 "미확인" 으로 다룬다.
 * (모델이 정말 준비되지 않았다면 /recognize 가 503 으로 알려주고, 그 경로는
 * useRecognizer 의 model_unavailable 이 처리한다.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ModelInfo, VocabularyCatalog } from '@ear-dream/core';

import { api } from '../../../api';

export interface ServerCatalog {
  /** 로드 실패 시 null (= 미확인). */
  vocabulary: VocabularyCatalog | null;
  /** 로드 실패 시 null (= 미확인). min/max_frames 등 계약 파라미터가 들어 있다. */
  model: ModelInfo | null;
  loading: boolean;
  /** 둘 다 실패했을 때만 true — 화면은 배너 수준으로만 알린다. */
  unreachable: boolean;
  reload: () => void;
}

export function useVocabulary(): ServerCatalog {
  const [vocabulary, setVocabulary] = useState<VocabularyCatalog | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setUnreachable(false);

    // 한쪽만 실패해도 나머지는 살린다.
    const [vocabResult, modelResult] = await Promise.allSettled([
      api.GET('/api/v1/vocabulary'),
      api.GET('/api/v1/model'),
    ]);
    if (generation !== generationRef.current) return; // reload 가 겹치면 이전 결과 폐기

    const vocab =
      vocabResult.status === 'fulfilled' ? (vocabResult.value.data ?? null) : null;
    const modelInfo =
      modelResult.status === 'fulfilled' ? (modelResult.value.data ?? null) : null;

    setVocabulary(vocab);
    setModel(modelInfo);
    setUnreachable(vocab === null && modelInfo === null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { vocabulary, model, loading, unreachable, reload };
}
