/**
 * 음성 출력 훅 — 웹(SpeechSynthesis) 구현.
 *
 * 브라우저 기본 API만 쓴다 — 새 의존성 없음. 마이크 레벨(useMicLevels)과 같은 방침이다.
 *
 * 화면에 들어오면 한 번 읽는다. 자동재생 정책상 사용자 제스처 없이 소리를 내면 막히는
 * 브라우저가 있지만, 이 화면은 "결과 확인" 탭으로만 들어오므로 제스처가 이미 있다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { SpeechStatus, UseSpeechResult } from './types';

export function useSpeech(sentence: string): UseSpeechResult {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // 말하는 중 화면을 벗어나면 끊어야 해서 현재 발화를 들고 있는다.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;

  const stop = useCallback(() => {
    if (!synth) return;
    synth.cancel();
    utteranceRef.current = null;
  }, [synth]);

  const speak = useCallback(() => {
    if (!synth) {
      setStatus('unsupported');
      setError('이 브라우저에서는 음성 합성을 쓸 수 없습니다.');
      return;
    }
    if (sentence.trim().length === 0) return;

    // 이전 발화가 남아 있으면 겹쳐 읽는다. 항상 처음부터 다시.
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(sentence);
    // 목소리 선택은 하지 않는다. getVoices() 는 비동기로 채워져 첫 호출에 비어 있는 일이 잦고,
    // 설치된 한국어 목소리는 환경마다 다르다. lang 만 주고 브라우저가 고르게 둔다.
    utterance.lang = SPEECH_LANG;
    utterance.onstart = () => setStatus('speaking');
    utterance.onend = () => setStatus('idle');
    utterance.onerror = (event) => {
      // 화면을 벗어나며 cancel() 한 것도 error('canceled'/'interrupted')로 들어온다 —
      // 이건 실패가 아니라 정상 종료다.
      if (event.error === 'canceled' || event.error === 'interrupted') {
        setStatus('idle');
        return;
      }
      setStatus('error');
      setError('음성을 재생하지 못했습니다.');
    };

    utteranceRef.current = utterance;
    setError(null);
    synth.speak(utterance);
  }, [sentence, synth]);

  useEffect(() => {
    speak();
    return stop;
  }, [speak, stop]);

  return { status, speak, stop, error };
}

/** 한국어 음성. 설치된 목소리가 없으면 브라우저가 기본 목소리로 읽는다. */
const SPEECH_LANG = 'ko-KR';
