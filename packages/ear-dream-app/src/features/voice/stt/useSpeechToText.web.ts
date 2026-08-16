/**
 * 음성 인식 훅 — 웹 구현. 현재는 **브라우저 엔진 한 경로**다.
 *
 * 이 파일이 하는 일은 브라우저 API 를 부르는 것이 아니라(그건 browserRecognition.ts),
 * 엔진의 들쭉날쭉한 종료 동작을 화면이 이해할 수 있는 상태로 정리하는 것이다:
 *
 *   1. 엔진이 **조용히 멈추는 것**을 메운다 — `continuous = true` 를 줘도 무음이 이어지면
 *      스스로 끝내는 브라우저가 있다. 사용자는 정지를 누르지 않았으므로 다시 연다
 *      (상한 STT_MAX_AUTO_RESTARTS).
 *   2. 한 마디도 잡히지 않으면 STT_NO_SPEECH_TIMEOUT_MS 뒤에 빈 결과로 끝낸다 —
 *      `onend` 조차 오지 않는 환경에서 화면이 "듣고 있어요"에 갇히는 것을 막는 유일한 탈출구다.
 *      말이 한 번이라도 잡히면 이 타이머는 해제된다(말하다 쉰 것을 실패로 처리하지 않는다).
 *   3. 정지를 눌렀는데 종료 통지가 오지 않으면 STT_FINALIZE_TIMEOUT_MS 뒤에 그대로 확정한다.
 *
 * 세션 하나당 `onResult` 는 정확히 한 번 나간다(빈 문자열 = 못 알아들었다). `cancel()` 로
 * 끝낸 세션은 나가지 않는다.
 *
 * ⚠️ **마이크 경합** — 이 훅은 마이크를 직접 열지 않지만(엔진이 연다), 같은 화면의
 * `voice/audio/useMicLevels` 가 파형을 그리려고 getUserMedia 로 스트림을 따로 잡는다.
 * 두 캡처가 부딪히면 이쪽은 'audio-capture'(= no-microphone) 실패로 나타난다.
 * 실기기 확인 전이므로 대응은 넣지 않았고, 잘라낼 자리는 VoiceInputScreen 주석에 있다.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * **서버 STT 를 꽂는 자리 — 여기다.**
 *
 * 갈아끼울 때 화면(VoiceInputScreen)과 계약(types.ts)은 건드리지 않는다. 붙일 것은 셋이다.
 *
 *   1. `serverRecognition.ts` — browserRecognition.ts 와 같은 모양의 명령형 래퍼.
 *      `MediaRecorder` 로 오디오를 모으고, 정지 시 서버에 올려 텍스트를 받는다.
 *      (참고: 브라우저 엔진과 달리 중간 결과가 없다. `onInterim` 을 부르지 않으면
 *      화면은 중간 텍스트 없이 그대로 동작한다 — 계약이 이미 빈 값을 허용한다.)
 *   2. 이 훅에서 **서버 우선 → 브라우저 폴백** 분기. `transcript/speech/useSpeech.web.ts`
 *      가 서버 TTS 로 같은 구조를 이미 하고 있으니 그 형태를 그대로 옮긴다.
 *      `engine` 을 'server' / 'browser' 로 채워 어느 쪽으로 인식했는지 드러낸다.
 *   3. `status` 의 'processing' 을 실제로 쓴다 — 업로드·응답 대기 구간이다.
 *
 * 서버 엔드포인트는 아직 없다. 만들 때 요청/응답 타입은 **손으로 정의하지 말고**
 * Pydantic 스키마 추가 → `pnpm generate:api-types` → `@ear-dream/core` import 순서로 간다.
 * API 키가 필요한 클라우드 STT 를 앱에서 직접 부르지 않는다 — 정적 번들이라 키가 노출된다.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { strings } from '../../../constants/strings';
import type {
  BrowserRecognitionAvailability,
  BrowserRecognitionFailure,
  BrowserRecognitionSession,
} from './browserRecognition';
import { getBrowserRecognitionAvailability, startBrowserRecognition } from './browserRecognition';
import {
  STT_FINALIZE_TIMEOUT_MS,
  STT_MAX_AUTO_RESTARTS,
  STT_NO_SPEECH_TIMEOUT_MS,
} from './config';
import type {
  SpeechToTextEngine,
  SpeechToTextStatus,
  UseSpeechToTextOptions,
  UseSpeechToTextResult,
} from './types';

export function useSpeechToText(options?: UseSpeechToTextOptions): UseSpeechToTextResult {
  // 콜백 신원이 매 렌더 바뀌어도 세션이 흔들리지 않게 ref 로 들고 최신 것을 부른다.
  const onResultRef = useRef(options?.onResult);
  onResultRef.current = options?.onResult;

  // 엔진 유무는 세션과 무관하게 처음부터 알 수 있다. 화면이 마운트 시점에 "이 환경에서는
  // 못 쓴다"를 알아야 키보드 입력으로 미리 안내할 수 있으므로 start() 를 기다리지 않는다.
  const availabilityRef = useRef<BrowserRecognitionAvailability | null>(null);
  if (availabilityRef.current === null) {
    availabilityRef.current = getBrowserRecognitionAvailability();
  }
  const availability = availabilityRef.current;

  const [status, setStatus] = useState<SpeechToTextStatus>(
    availability === 'ok' ? 'idle' : 'unsupported',
  );
  const [engine, setEngine] = useState<SpeechToTextEngine | null>(null);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(
    availability === 'ok' ? null : unavailableMessage(availability),
  );

  const sessionRef = useRef<BrowserRecognitionSession | null>(null);
  /** 확정된 조각들. 이어 붙인 것이 최종 텍스트다. */
  const finalPartsRef = useRef<string[]>([]);
  /** 중간 텍스트의 최신값. 콜백에서 state 를 읽으면 낡은 값이 잡힌다. */
  const interimRef = useRef('');
  const restartsRef = useRef(0);
  /** 사용자가 듣기 세션 안에 있는가. 늦게 도착한 콜백을 걸러내는 소유권 표시이기도 하다. */
  const listeningRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearSilenceTimer();
    if (finalizeTimerRef.current !== null) {
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
  }, [clearSilenceTimer]);

  /** 세션을 끝내고 결과를 내보낸다. 여러 경로에서 불려도 한 번만 실행된다. */
  const finish = useCallback(() => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    clearTimers();
    sessionRef.current = null;

    const finals = finalPartsRef.current.join(' ').trim();
    // 확정 조각이 하나도 없을 때만 중간 텍스트를 쓴다. 흔들리는 값이지만, 정지를 눌렀는데
    // 화면에 보이던 글자가 통째로 사라지는 것보다는 낫다.
    const text = finals.length > 0 ? finals : interimRef.current.trim();

    interimRef.current = '';
    setInterimTranscript('');
    setTranscript(text);
    setStatus('idle');

    onResultRef.current?.(text);
  }, [clearTimers]);

  /** 말이 잡혔다 — 무음 안전장치를 해제하고 재시작 횟수를 되돌린다. */
  const noteSpeech = useCallback(() => {
    restartsRef.current = 0;
    clearSilenceTimer();
  }, [clearSilenceTimer]);

  /** 실패로 세션을 끝낸다. 결과를 내보내지 않는다 — 화면은 status/error 로 안내한다. */
  const fail = useCallback(
    (failure: BrowserRecognitionFailure) => {
      listeningRef.current = false;
      clearTimers();
      sessionRef.current = null;
      interimRef.current = '';
      setInterimTranscript('');
      setStatus(failure === 'denied' ? 'denied' : 'error');
      setError(failureMessage(failure));
    },
    [clearTimers],
  );

  // 이름 있는 함수 표현식이라 재시작(open())을 자기 자신으로 부를 수 있다.
  const openSession = useCallback(
    function open() {
      const session = startBrowserRecognition({
        onStart: () => {
          if (!listeningRef.current) return;
          setStatus('listening');
        },
        onInterim: (text) => {
          if (!listeningRef.current) return;
          interimRef.current = text;
          setInterimTranscript(text);
          if (text.trim().length > 0) noteSpeech();
        },
        onFinal: (text) => {
          if (!listeningRef.current) return;
          finalPartsRef.current.push(text.trim());
          interimRef.current = '';
          setInterimTranscript('');
          setTranscript(finalPartsRef.current.join(' ').trim());
          noteSpeech();
        },
        onFailure: (failure) => {
          if (!listeningRef.current) return;
          // 아직 말소리를 못 찾았을 뿐이다. 바로 뒤에 onEnd 가 따라오고 거기서 다시 연다.
          if (failure === 'no-speech') return;
          fail(failure);
        },
        onEnd: (reason) => {
          sessionRef.current = null;
          // cancel() 은 이미 정리를 끝냈고, 실패로 끝난 경우 listeningRef 가 내려가 있다.
          if (reason === 'canceled' || !listeningRef.current) return;
          if (reason === 'stopped') {
            finish();
            return;
          }
          // 'auto' — 사용자는 정지를 누르지 않았는데 엔진이 스스로 끝냈다.
          if (restartsRef.current >= STT_MAX_AUTO_RESTARTS) {
            // 열자마자 끝나는 환경이다. 무한 재시작 대신 그때까지 인식한 것으로 끝낸다.
            finish();
            return;
          }
          restartsRef.current += 1;
          open();
        },
      });

      if (!session) {
        // 생성자는 있었는데 시작하지 못한 경우. 사용자가 할 수 있는 일은 키보드 입력뿐이다.
        listeningRef.current = false;
        clearTimers();
        setStatus('unsupported');
        setError(strings.voiceInput.stt.unsupported);
        return;
      }
      sessionRef.current = session;
    },
    [clearTimers, fail, finish, noteSpeech],
  );

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    listeningRef.current = false;
    clearTimers();
    session?.cancel();

    finalPartsRef.current = [];
    interimRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    // 미지원·권한 거부는 취소로 지워지는 상태가 아니다 — 이유를 계속 보여줘야 한다.
    setStatus((previous) =>
      previous === 'unsupported' || previous === 'denied' || previous === 'error'
        ? previous
        : 'idle',
    );
  }, [clearTimers]);

  const start = useCallback(() => {
    if (availability !== 'ok') {
      setStatus('unsupported');
      setError(unavailableMessage(availability));
      return;
    }

    cancel();
    finalPartsRef.current = [];
    interimRef.current = '';
    restartsRef.current = 0;
    setTranscript('');
    setInterimTranscript('');
    setError(null);
    setEngine('browser');
    setStatus('starting');
    listeningRef.current = true;

    silenceTimerRef.current = setTimeout(() => {
      // 한 마디도 잡히지 않았다. 빈 결과로 끝내면 화면이 "다시 말씀해 주세요"를 띄운다.
      finish();
    }, STT_NO_SPEECH_TIMEOUT_MS);

    openSession();
  }, [availability, cancel, finish, openSession]);

  const stop = useCallback(() => {
    if (!listeningRef.current) return;
    // 무음 안전장치는 여기서 역할이 끝난다 — 확정을 기다리는 동안 끼어들면 안 된다.
    clearSilenceTimer();
    setStatus('processing');

    const session = sessionRef.current;
    if (!session) {
      finish();
      return;
    }
    // 종료 통지가 오지 않는 브라우저 대비. 정상 경로에서는 onEnd 가 먼저 와서 이 타이머를 지운다.
    finalizeTimerRef.current = setTimeout(() => {
      console.warn('[stt] 종료 통지가 오지 않아 그때까지 인식한 텍스트로 확정합니다.');
      finish();
    }, STT_FINALIZE_TIMEOUT_MS);
    session.stop();
  }, [clearSilenceTimer, finish]);

  // 화면을 벗어나면 마이크를 놓는다. 결과는 쓰지 않는다.
  useEffect(() => cancel, [cancel]);

  return { status, engine, transcript, interimTranscript, start, stop, cancel, error };
}

function unavailableMessage(availability: BrowserRecognitionAvailability): string {
  return availability === 'insecure-context'
    ? strings.voiceInput.stt.insecureContext
    : strings.voiceInput.stt.unsupported;
}

function failureMessage(failure: BrowserRecognitionFailure): string {
  switch (failure) {
    case 'denied':
      return strings.voiceInput.stt.denied;
    case 'no-microphone':
      return strings.voiceInput.stt.noMicrophone;
    case 'network':
      return strings.voiceInput.stt.network;
    default:
      return strings.voiceInput.stt.failed;
  }
}
