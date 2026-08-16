/**
 * 음성 인식 훅 — 네이티브(기본) 구현.
 *
 * 웹에서는 번들러가 useSpeechToText.web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 *
 * 네이티브에는 아직 음성 인식 수단이 없다. `expo-speech-recognition` 같은 새 의존성을
 * 이 작업에서 추가하지 않았고, 마이크 캡처(`voice/audio/useMicLevels.ts`)도 같은 이유로
 * 네이티브에서는 비어 있다. 여기서는 'unsupported' 만 돌려주고, 화면은 **키보드 입력**으로
 * 안내한다 — 알려진 정상 상태다.
 *
 * **나중에 네이티브 음성 인식을 붙일 곳은 이 파일 하나다.** types.ts 의 계약만 맞추면
 * 화면 코드는 그대로 쓴다. 붙일 수 있는 경로는 둘이고, 어느 쪽이든 이 파일 안에서 끝난다.
 *
 *   1. 네이티브 STT 모듈(iOS Speech / Android SpeechRecognizer 래퍼) — 새 의존성 결정 필요
 *   2. 서버 STT — 오디오를 녹음해 올리는 방식. 이 경우 웹 구현과 서버 호출 코드를 공유하게
 *      되므로, 그 자리를 어디에 둘지는 useSpeechToText.web.ts 의 「서버 STT 를 꽂는 자리」
 *      주석과 함께 판단한다
 *
 * ⚠️ 그때 주의할 것: 오디오 캡처가 생기면 마이크를 여는 주체가 이 훅과 useMicLevels 둘이
 * 된다. 웹에서 실제로 겪은 문제라 네이티브에서도 먼저 확인할 항목이다
 * (useSpeechToText.web.ts 의 마이크 경합 주석 참고).
 */
import { useCallback } from 'react';

import { strings } from '../../../constants/strings';
import type { UseSpeechToTextOptions, UseSpeechToTextResult } from './types';

export function useSpeechToText(_options?: UseSpeechToTextOptions): UseSpeechToTextResult {
  const noop = useCallback(() => {}, []);

  return {
    status: 'unsupported',
    engine: null,
    transcript: '',
    interimTranscript: '',
    start: noop,
    stop: noop,
    cancel: noop,
    error: strings.voiceInput.stt.unsupportedNative,
  };
}
