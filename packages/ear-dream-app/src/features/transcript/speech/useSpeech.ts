/**
 * 음성 출력 훅 — 네이티브(기본) 구현.
 *
 * 웹에서는 번들러가 useSpeech.web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 *
 * 네이티브에는 아직 소리를 낼 수단이 없다. `expo-av`·`expo-speech` 모두 설치되어 있지
 * 않고, 이 작업에서 새 의존성을 추가하지 않았다. 여기서는 'unsupported' 만 돌려주고,
 * 화면은 소리 대신 문장을 크게 보여주는 쪽으로 안내한다 — 알려진 정상 상태다.
 *
 * **나중에 네이티브 음성을 붙일 곳은 이 파일 하나다.** 서버 TTS(`POST /api/v1/speech`)는
 * 플랫폼과 무관하게 WAV 바이트를 주므로, 오디오 재생 수단(예: `expo-av`)만 정해지면
 * useSpeech.web.ts 와 같은 "서버 우선 → 폴백" 구조를 그대로 옮길 수 있다. 다만 네이티브
 * 폴백에 해당하는 브라우저 SpeechSynthesis 는 없으니 그 자리를 무엇으로 채울지
 * (`expo-speech` 도입 여부)는 팀 결정이 필요하다.
 */
import { useCallback } from 'react';

import type { SpeechTags, UseSpeechResult } from './types';

export function useSpeech(_sentence: string, _tags?: SpeechTags): UseSpeechResult {
  const noop = useCallback(() => {}, []);

  return {
    status: 'unsupported',
    engine: null,
    speak: noop,
    stop: noop,
    error: '음성 출력은 현재 웹에서만 동작합니다.',
  };
}
