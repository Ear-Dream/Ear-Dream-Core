/**
 * 브라우저 음성 합성(SpeechSynthesis) — 서버 TTS 의 폴백 경로.
 *
 * 원래 useSpeech.web.ts 의 본체였던 코드를 그대로 옮겨 왔다. 서버 TTS 가 붙으면서
 * **주 경로가 아니라 폴백**이 됐지만, 동작 자체는 검증된 것이라 손대지 않는다.
 *
 * 여기로 내려오는 것은 고장이 아니다 — vLLM-Omni 는 CUDA 전용이라 맥에서는 서버가
 * 항상 503(= "이 서버로는 못 읽는다")을 주고, 그때 소리를 내는 유일한 수단이 이쪽이다.
 * 사용자에게 에러로 보이면 안 된다.
 *
 * **웹 전용 모듈이다.** import 하는 곳은 useSpeech.web.ts 하나뿐이라 네이티브 번들에는
 * 들어가지 않는다.
 *
 * 훅이 아니라 명령형 함수인 이유: 재생 주체(서버 오디오 / 브라우저 합성)를 요청 결과에
 * 따라 런타임에 고르기 때문에, 훅으로 만들면 호출 순서 규칙에 걸린다.
 */

/** 한국어 음성. 설치된 목소리가 없으면 브라우저가 기본 목소리로 읽는다. */
const SPEECH_LANG = 'ko-KR';

export interface BrowserSynthesisCallbacks {
  onStart: () => void;
  /** 다 읽었거나 취소로 끝났다 — 둘 다 정상 종료다. */
  onEnd: () => void;
  /** 합성 자체가 실패했다. 취소는 여기로 오지 않는다. */
  onFailure: () => void;
}

function getSynth(): SpeechSynthesis | undefined {
  return typeof window === 'undefined' ? undefined : window.speechSynthesis;
}

/** 진행 중인 브라우저 합성을 끊는다. 없으면 아무 일도 하지 않는다. */
export function cancelBrowserSynthesis(): void {
  getSynth()?.cancel();
}

/**
 * 브라우저 음성으로 읽기 시작한다.
 *
 * @returns 이 브라우저에 합성 수단이 없어 시작조차 못 했으면 false.
 */
export function speakWithBrowserSynthesis(
  sentence: string,
  callbacks: BrowserSynthesisCallbacks,
): boolean {
  const synth = getSynth();
  if (!synth) return false;

  // 이전 발화가 남아 있으면 겹쳐 읽는다. 항상 처음부터 다시.
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(sentence);
  // 목소리 선택은 하지 않는다. getVoices() 는 비동기로 채워져 첫 호출에 비어 있는 일이 잦고,
  // 설치된 한국어 목소리는 환경마다 다르다. lang 만 주고 브라우저가 고르게 둔다.
  utterance.lang = SPEECH_LANG;
  utterance.onstart = callbacks.onStart;
  utterance.onend = callbacks.onEnd;
  utterance.onerror = (event) => {
    // 화면을 벗어나며 cancel() 한 것도 error('canceled'/'interrupted')로 들어온다 —
    // 이건 실패가 아니라 정상 종료다.
    if (event.error === 'canceled' || event.error === 'interrupted') {
      callbacks.onEnd();
      return;
    }
    callbacks.onFailure();
  };

  synth.speak(utterance);
  return true;
}
