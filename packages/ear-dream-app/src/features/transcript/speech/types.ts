/**
 * 음성 출력(TTS) 훅의 플랫폼 중립 계약.
 *
 * 구현이 브라우저 SpeechSynthesis 든 네이티브 모듈이든 화면 코드는 이 형태만 본다.
 */
export type SpeechStatus =
  /** 대기. 아직 말하지 않았거나 다 말했다. */
  | 'idle'
  /** 말하는 중. */
  | 'speaking'
  /** 이 플랫폼에서 음성 합성을 쓸 수 없다. */
  | 'unsupported'
  /** 합성이 실패했다. */
  | 'error';

export interface UseSpeechResult {
  status: SpeechStatus;
  /** 문장을 (다시) 읽는다. 말하는 중이면 처음부터 다시 읽는다. */
  speak: () => void;
  stop: () => void;
  /** 사용자에게 보여줄 실패 사유. 실패가 아니면 null. */
  error: string | null;
}
