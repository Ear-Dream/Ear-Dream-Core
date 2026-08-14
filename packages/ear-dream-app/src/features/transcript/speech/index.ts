/**
 * 음성 출력 (TTS).
 *
 * 쓰는 쪽은 이 배럴만 보면 된다. 플랫폼별 구현(.web / 네이티브)은 번들러가 고른다.
 *
 *   const { status, engine, speak, error } = useSpeech(sentence, { emotion, style });
 *
 * 화면에 들어오면 한 번 읽고, `speak()` 로 다시 읽는다. 태그는 `/compose-sentence` 응답
 * candidate 의 `emotion`/`style` 을 그대로 넘기면 되고, 없으면 생략한다.
 *
 * 웹은 서버 TTS 를 먼저 쓰고 실패하면 브라우저 음성으로 내려간다 — `engine` 이 어느 쪽으로
 * 소리가 났는지 알려준다. 서버가 못 읽는 상황(503)은 **에러가 아니라 정상 폴백**이므로
 * 화면에서 실패로 표시하지 말 것.
 */
export { useSpeech } from './useSpeech';
export type { SpeechEngine, SpeechStatus, SpeechTags, UseSpeechResult } from './types';
