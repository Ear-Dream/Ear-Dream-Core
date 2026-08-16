/**
 * 음성 인식 (STT) — 청인 트랙의 "입으로 말하기" 입력.
 *
 * 쓰는 쪽은 이 배럴만 보면 된다. 플랫폼별 구현(.web / 네이티브)은 번들러가 고르고,
 * 어떤 엔진을 쓰는지(브라우저 / 서버 / 네이티브)는 화면이 알 필요가 없다.
 *
 *   const stt = useSpeechToText({ onResult: (text) => { ... } });
 *   stt.start();   // 마이크 탭
 *   stt.stop();    // 정지 탭 → onResult 로 텍스트가 나온다
 *
 * `onResult` 는 세션당 한 번 오고, **빈 문자열이면 아무 말도 알아듣지 못했다**는 뜻이다.
 * `status === 'unsupported'` 는 고장이 아니라 **정상 경로**다 — 네이티브와 엔진이 없는
 * 브라우저(iOS 계열 등)가 여기로 오고, 화면은 키보드 입력으로 안내해야 한다.
 *
 * 오디오를 저장하거나 앱 서버로 보내지 않는다(현재 브라우저 엔진 기준 — 브라우저 공급자
 * 클라우드는 거친다. browserRecognition.ts 상단 주석 참고).
 */
export { useSpeechToText } from './useSpeechToText';
export type {
  SpeechToTextEngine,
  SpeechToTextStatus,
  UseSpeechToTextOptions,
  UseSpeechToTextResult,
} from './types';
