/**
 * 음성 인식(STT) 훅의 플랫폼 중립 계약.
 *
 * 구현이 브라우저 Web Speech API 든 서버 STT(Whisper · ElevenLabs Scribe 등)든 네이티브
 * 모듈이든 화면 코드는 이 형태만 본다. **엔진을 갈아끼울 때 화면이 한 줄도 바뀌지 않는 것**이
 * 이 파일의 존재 이유다 — `landmarks/types.ts`, `transcript/speech/types.ts`,
 * `voice/audio/types.ts` 와 같은 취지다.
 *
 * 이 파일에는 DOM 타입도 브라우저 API 도 등장하지 않는다. 등장하는 순간 계약이 특정 엔진에
 * 묶인다.
 */

export type SpeechToTextStatus =
  /** 대기. 아직 듣기 시작하지 않았거나, 한 세션이 끝났다. */
  | 'idle'
  /** 마이크 권한 · 엔진 준비 중. 아직 소리를 받지 않는다. */
  | 'starting'
  /** 듣는 중. 중간 텍스트가 흘러나올 수 있다. */
  | 'listening'
  /**
   * 듣기는 끝났고 최종 텍스트를 확정하는 중.
   *
   * 브라우저 엔진에서는 거의 순간이라 눈에 띄지 않지만, **서버 STT 는 여기서 오디오를
   * 업로드하고 응답을 기다린다** — 그 구간을 화면이 표시할 수 있어야 해서 계약에 둔다
   * (`transcript/speech` 의 'loading' 과 같은 자리).
   */
  | 'processing'
  /** 사용자가 마이크 권한을 거부했다. */
  | 'denied'
  /**
   * 이 환경에서 음성 인식을 쓸 수 없다. **정상 경로다** — 네이티브(미구현)와 엔진이 없는
   * 브라우저(iOS Safari 등)가 여기로 온다. 화면은 키보드 입력으로 안내한다.
   */
  | 'unsupported'
  /** 그 밖의 실패(마이크 없음 · 네트워크 등). */
  | 'error';

/** 어느 경로로 인식했는지. 아직 시작 전이면 null. */
export type SpeechToTextEngine =
  /** 브라우저 내장 음성 인식(Web Speech API). 현재 유일한 구현. */
  | 'browser'
  /**
   * 서버 STT. **아직 구현이 없다** — 계약에만 자리를 만들어 둔 값이다.
   * 꽂는 자리는 `useSpeechToText.web.ts` 주석 참고.
   */
  | 'server';

export interface UseSpeechToTextOptions {
  /**
   * 인식 세션이 끝났을 때 **정확히 한 번** 호출된다.
   *
   * - 텍스트가 있으면: 사용자가 정지를 눌렀거나 엔진이 발화 끝을 판단했다
   * - **빈 문자열이면: 아무 말도 알아듣지 못했다** — 화면은 "다시 말씀해 주세요" 안내를 띄운다
   *
   * `cancel()` 로 끝낸 세션에서는 호출되지 않는다(사용자가 버린 결과다).
   * 함수 신원이 매 렌더 바뀌어도 세션은 영향을 받지 않는다.
   */
  onResult?: (text: string) => void;
}

export interface UseSpeechToTextResult {
  status: SpeechToTextStatus;
  engine: SpeechToTextEngine | null;
  /** 지금까지 **확정된** 텍스트. 세션이 끝나면 이 값이 onResult 로 나간다. */
  transcript: string;
  /**
   * 아직 확정되지 않은 중간 텍스트. 확정되면 transcript 로 옮겨가고 여기는 비워진다.
   * 표시 전용이다 — 흔들리는 값이라 확정 결과로 쓰지 않는다.
   */
  interimTranscript: string;
  /** 엔진 이벤트 순서 (진단용). 개발 화면에서만 노출한다 — 제품 동작에는 쓰지 않는다. */
  trace: string[];
  /** 듣기 시작. 이전 세션의 텍스트는 지워진다. */
  start: () => void;
  /** 정상 종료 — 지금까지 인식한 것을 확정해 onResult 로 넘긴다. */
  stop: () => void;
  /** 폐기 — 결과를 쓰지 않고 끝낸다. onResult 는 호출되지 않는다. */
  cancel: () => void;
  /** 사용자에게 보여줄 실패·미지원 사유. 문제가 없으면 null. */
  error: string | null;
}
