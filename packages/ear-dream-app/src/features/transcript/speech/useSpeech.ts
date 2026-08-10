/**
 * 음성 출력 훅 — 네이티브(기본) 구현.
 *
 * 웹에서는 번들러가 useSpeech.web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 *
 * 네이티브에는 아직 음성 합성 수단이 없다. `expo-speech` 는 설치되어 있지 않다.
 * 여기서는 'unsupported' 만 돌려주고, 화면은 소리 대신 문장을 크게 보여주는 쪽으로 안내한다
 * — 알려진 정상 상태다.
 *
 * 나중에 네이티브를 지원할 때 바꿀 곳은 이 파일 하나다. types.ts 의 UseSpeechResult 만
 * 맞춰 구현하면 화면 코드는 그대로 쓴다.
 */
import { useCallback } from 'react';

import type { UseSpeechResult } from './types';

export function useSpeech(_sentence: string): UseSpeechResult {
  const noop = useCallback(() => {}, []);

  return {
    status: 'unsupported',
    speak: noop,
    stop: noop,
    error: '음성 출력은 현재 웹에서만 동작합니다.',
  };
}
