/**
 * 음성 출력 (TTS).
 *
 * 쓰는 쪽은 이 배럴만 보면 된다. 플랫폼별 구현(.web / 네이티브)은 번들러가 고른다.
 *
 *   const { status, speak, error } = useSpeech(sentence);
 *
 * 화면에 들어오면 한 번 읽고, `speak()` 로 다시 읽는다.
 */
export { useSpeech } from './useSpeech';
export type { SpeechStatus, UseSpeechResult } from './types';
