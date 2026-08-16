/**
 * 브라우저 음성 인식(Web Speech API) — 현재 유일한 STT 경로.
 *
 * `transcript/speech/browserSynthesis.ts` 와 같은 자리의 모듈이다: 브라우저 API 를 그대로
 * 감싼 **명령형 래퍼**이고, 상태 관리와 정책(재시작 · 타임아웃)은 훅이 가져간다.
 * 훅이 아니라 함수인 이유도 같다 — 세션을 사용자 조작 시점에 열고 닫아야 해서 호출 순서
 * 규칙에 걸린다.
 *
 * **웹 전용 모듈이다.** import 하는 곳은 useSpeechToText.web.ts 하나뿐이라 네이티브 번들에는
 * 들어가지 않는다.
 *
 * 알아 둘 것:
 *
 * - **보안 컨텍스트가 필요하다.** http 로 열면 엔진이 아예 없거나 start() 가 곧바로 실패한다.
 *   카메라(useLandmarker.web.ts)와 같은 제약이고 해법도 같다 — https 서빙 또는 localhost.
 * - **엔진이 없는 브라우저가 정상적으로 존재한다.** 특히 iOS 는 지원 여부에 대한 자료가
 *   엇갈린다(Safari 14.5+ 지원 vs WebKit 미구현). 확인되지 않았으므로 **안 되는 쪽을 기본
 *   경로로 보고** 설계했다 — 없으면 조용히 null 을 돌려주고 화면은 키보드 입력으로 안내한다.
 * - **인식은 기기 안에서만 일어나지 않는다.** Chrome 계열은 오디오를 자사 클라우드로 보내
 *   변환한다. 앱이 키를 들고 있지도 오디오를 저장하지도 않지만, 사용자 음성이 브라우저
 *   공급자를 거친다는 사실 자체는 서버 STT 도입을 판단할 때 함께 놓고 봐야 한다.
 */

/** 인식 언어. 서비스가 한국어 전용이라 고정한다(browserSynthesis.ts 의 SPEECH_LANG 과 같은 값). */
const RECOGNITION_LANG = 'ko-KR';

/**
 * 인식 세션이 끝난 이유.
 * `onend` 는 정지 · 폐기 · 자동 종료 어느 쪽으로 끝나도 똑같이 오기 때문에, 어느 쪽이었는지는
 * stop()/cancel() 을 실제로 호출한 이 모듈이 기억해 알려준다.
 */
export type BrowserRecognitionEndReason =
  /** stop() — 사용자가 정지를 눌렀다. */
  | 'stopped'
  /** cancel() — 결과를 버리고 끝냈다. */
  | 'canceled'
  /** 엔진이 스스로 끝냈다(무음 자동 종료 등). 사용자는 아무것도 누르지 않았다. */
  | 'auto';

/** 실패 종류. 사용자 문구로 바꾸는 것은 훅 몫이다(문구는 constants/strings.ts). */
export type BrowserRecognitionFailure =
  /** 마이크 권한 거부. */
  | 'denied'
  /** 쓸 수 있는 마이크가 없다. */
  | 'no-microphone'
  /** 인식 서비스에 닿지 못했다. */
  | 'network'
  /**
   * 이 구간에서 말소리를 찾지 못했다. **실패가 아니다** — 사용자가 아직 말을 시작하지
   * 않았을 뿐이라 곧바로 `onend` 가 따라온다. 훅은 이걸로 상태를 바꾸지 않는다.
   */
  | 'no-speech'
  /** 그 밖. */
  | 'other';

export interface BrowserRecognitionCallbacks {
  /** 마이크가 열려 실제로 듣기 시작했다. */
  onStart: () => void;
  /** 아직 확정되지 않은 텍스트. 확정 전까지 계속 바뀐다(빈 문자열일 수 있다). */
  onInterim: (text: string) => void;
  /** 확정된 조각 하나. 여러 번 올 수 있어 이어 붙이는 것은 훅 몫이다. */
  onFinal: (text: string) => void;
  /** 취소(`aborted`)는 여기로 오지 않는다 — 정상 종료라서 onEnd 로만 알린다. */
  onFailure: (failure: BrowserRecognitionFailure) => void;
  /** 세션 종료. 어떤 경로로 끝나든 마지막에 정확히 한 번 온다. */
  onEnd: (reason: BrowserRecognitionEndReason) => void;
}

export interface BrowserRecognitionSession {
  /** 정상 종료. 진행 중이던 발화가 확정된 뒤 onEnd('stopped') 가 온다. */
  stop: () => void;
  /** 폐기. 결과를 기다리지 않고 즉시 끊는다. onEnd('canceled') 가 온다. */
  cancel: () => void;
}

/** 이 환경에서 브라우저 음성 인식을 쓸 수 있는지, 못 쓴다면 왜인지. */
export type BrowserRecognitionAvailability =
  | 'ok'
  /** 이 브라우저에 음성 인식 엔진이 없다 (iOS 계열 등). */
  | 'no-engine'
  /** http 로 열려 있다 — 엔진이 있어도 마이크가 열리지 않는다. */
  | 'insecure-context';

export function getBrowserRecognitionAvailability(): BrowserRecognitionAvailability {
  if (typeof window === 'undefined') return 'no-engine';
  // 보안 컨텍스트를 먼저 본다. 엔진이 노출돼 있어도 http 면 start() 가 실패하는데, 그때의
  // 에러 코드('not-allowed')는 권한 거부와 구분되지 않아 안내가 엉뚱해진다.
  if (window.isSecureContext === false) return 'insecure-context';
  return getRecognitionCtor() === undefined ? 'no-engine' : 'ok';
}

/**
 * 인식을 시작한다.
 *
 * @returns 엔진이 없거나 시작하지 못했으면 null. (그 경우 콜백은 하나도 호출되지 않는다.)
 */
export function startBrowserRecognition(
  callbacks: BrowserRecognitionCallbacks,
): BrowserRecognitionSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = RECOGNITION_LANG;
  // 브라우저 기본값(false)은 한 문장만 받고 끝낸다. 사용자가 정지를 누를 때까지 이어 받도록
  // 켜지만, 이걸 켜도 무음이 길어지면 스스로 끝내는 브라우저가 있다 — 그 뒤처리는 훅에 있다.
  recognition.continuous = true;
  // 중간 결과를 켠다. 폰을 든 사람은 **농인이라 상대의 말소리를 듣지 못하므로**, 말이 글자로
  // 실시간으로 쌓이는 것이 "지금 잘 잡히고 있다"를 알 수 있는 유일한 신호다(파형은 소리가
  // 났다는 것만 알려준다). 흔들리는 값이라 확정 결과로는 쓰지 않고 표시에만 쓴다.
  recognition.interimResults = true;
  // 후보를 여러 개 받지 않는다. 화면에 후보 선택 UI 가 없고, 있어도 청인 트랙은 상대가 말한
  // 즉시 넘어가는 흐름이라 고를 시간이 없다.
  recognition.maxAlternatives = 1;

  /** stop()/cancel() 이 부른 종료인지. 아니면 엔진이 스스로 끝낸 것이다. */
  let endReason: BrowserRecognitionEndReason = 'auto';
  /** onEnd 를 두 번 부르지 않기 위한 빗장. */
  let ended = false;

  const finishOnce = () => {
    if (ended) return;
    ended = true;
    detach();
    callbacks.onEnd(endReason);
  };

  /** 핸들러를 떼어 늦게 도착한 이벤트가 끝난 세션을 건드리지 못하게 한다. */
  const detach = () => {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  };

  recognition.onstart = () => callbacks.onStart();

  recognition.onresult = (event) => {
    // resultIndex 부터가 이번에 바뀐 구간이다. 그 앞은 이미 확정으로 넘긴 것들이라 다시 읽으면
    // 같은 말이 두 번 들어간다.
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (text.length === 0) continue;
      if (result?.isFinal) {
        callbacks.onFinal(text);
      } else {
        interim += text;
      }
    }
    callbacks.onInterim(interim);
  };

  recognition.onerror = (event) => {
    // 'aborted' = cancel()/stop() 이 끊은 것. 실패가 아니라 정상 종료다 —
    // browserSynthesis.ts 가 'canceled'/'interrupted' 를 정상 처리하는 것과 같은 이유다.
    if (event.error === 'aborted') return;
    callbacks.onFailure(toFailure(event.error));
  };

  recognition.onend = () => finishOnce();

  try {
    recognition.start();
  } catch (cause) {
    // 이미 시작된 인스턴스에 start() 를 부르면 InvalidStateError 가 난다. 새 인스턴스라
    // 정상적으로는 오지 않지만, 여기서 던지면 화면이 "시작 중"에 갇히므로 막아 둔다.
    console.warn('[stt] 음성 인식을 시작하지 못했습니다.', cause);
    detach();
    return null;
  }

  return {
    stop: () => {
      endReason = 'stopped';
      // stop() 은 "지금까지 받은 소리를 마저 처리하고 끝내라"는 뜻이라 마지막 확정 결과가
      // onend 앞에 한 번 더 올 수 있다. 그래서 abort() 가 아니다.
      recognition.stop();
    },
    cancel: () => {
      endReason = 'canceled';
      // 결과를 버리는 경로라 즉시 끊는다.
      recognition.abort();
    },
  };
}

/**
 * 브라우저가 노출하는 음성 인식 인스턴스에서 **이 모듈이 실제로 쓰는 부분만** 좁게 선언한다.
 *
 * lib.dom(TS 6.0.3)에는 이벤트 타입(`SpeechRecognitionEvent` 등)은 있지만 인식 객체 자체의
 * 인터페이스가 없다. 그래서 객체만 여기서 선언하고 이벤트는 lib.dom 것을 그대로 쓴다 —
 * 이벤트까지 손으로 만들면 표준 정의와 어긋나도 컴파일이 통과한다.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 표준 이름과 webkit 접두사 양쪽을 본다. Chrome 계열은 아직 접두사 쪽만 있는 버전이 있다. */
function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

function toFailure(code: SpeechRecognitionErrorCode): BrowserRecognitionFailure {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'audio-capture':
      return 'no-microphone';
    case 'network':
      return 'network';
    case 'no-speech':
      return 'no-speech';
    default:
      return 'other';
  }
}
