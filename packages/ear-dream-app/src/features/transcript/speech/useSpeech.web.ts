/**
 * 음성 출력 훅 — 웹 구현. **서버 TTS 우선 → 브라우저 음성 합성 폴백** 2경로다.
 *
 *   1. `POST /api/v1/speech` 로 문장+태그를 보내고 `audio/wav` 바이트를 받아 재생한다
 *      (engine='server'). 감정·말투가 반영된 소리는 이쪽뿐이다.
 *   2. 503 · 네트워크 실패 · 타임아웃 · 빈 응답이면 브라우저 음성으로 내려간다
 *      (engine='browser'). **이건 정상 경로다** — 서버 503 은 고장이 아니라 "이 서버로는
 *      못 읽는다"는 폴백 신호이고(라우트 주석), vLLM-Omni 가 CUDA 전용이라 맥 개발
 *      환경에서는 항상 이 경로를 탄다. 사용자에게 에러로 보이면 안 된다.
 *   3. 둘 다 실패했을 때만 status='error' 다.
 *
 * 서버 합성은 수 초가 걸린다(원본 README 실측 예시 6.1초). 그래서 status 에 'loading' 이
 * 있다 — 누르고 아무 반응 없는 구간을 화면이 표시할 수 있어야 한다.
 *
 * 늦은 응답 처리는 `features/recognition/api/useRecognitionQueue` 와 같은 방식이다:
 * AbortController 인스턴스 자체를 소유권 토큰으로 쓰고, 콜백은 자기 controller 가 아직
 * 현재 것인지(`owns()`) 확인한 뒤에만 상태를 건드린다. stop()/언마운트로 소유권을 잃은
 * 응답은 조용히 폐기되므로 늦게 온 음성이 뒤늦게 재생되는 일이 없다.
 *
 * 화면에 들어오면 한 번 읽는다. 자동재생 정책상 사용자 제스처 없이 소리를 내면 막히는
 * 브라우저가 있지만, 이 화면은 "결과 확인" 탭으로만 들어오므로 제스처가 이미 있다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../api';
import { isAbortError } from '../../recognition/api/isAbortError';
import { cancelBrowserSynthesis, speakWithBrowserSynthesis } from './browserSynthesis';
import type { SpeechEngine, SpeechStatus, SpeechTags, UseSpeechResult } from './types';

export function useSpeech(sentence: string, tags?: SpeechTags): UseSpeechResult {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 재생 중인 서버 오디오와 그 objectURL. objectURL 은 해제하지 않으면 blob 이 문서 수명
  // 내내 메모리에 남으므로 재생 끝·중단·언마운트 어디서 끝나든 반드시 revoke 한다.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // 진행 중 요청의 소유권 토큰. 콜백은 이게 자기 controller 인지로 유효성을 판별한다.
  const inflightRef = useRef<AbortController | null>(null);

  // tags 객체를 그대로 의존성에 넣으면 화면이 인라인 객체를 넘길 때 매 렌더 speak 가
  // 새로 만들어져 자동재생 effect 가 무한히 다시 돈다. 원시값으로 풀어서 쓴다.
  const emotion = tags?.emotion ?? null;
  const style = tags?.style ?? null;

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // 핸들러를 먼저 떼고 정지한다 — src 를 비우면 error 이벤트가 뜨는 브라우저가 있다.
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    // 소유권을 먼저 놓는다 — 아래 abort 로 깨어난 콜백들이 owns() 에서 걸러지게 한다.
    const controller = inflightRef.current;
    inflightRef.current = null;
    controller?.abort();
    releaseAudio();
    cancelBrowserSynthesis();
    setStatus('idle');
  }, [releaseAudio]);

  const speak = useCallback(() => {
    stop();

    const text = sentence.trim();
    if (text.length === 0) return;

    const controller = new AbortController();
    inflightRef.current = controller;
    /** 이 콜백이 아직 현재 재생인가 (stop()·언마운트·재요청으로 소유권 상실 검사). */
    const owns = () => inflightRef.current === controller;

    setError(null);
    setEngine(null);
    setStatus('loading');

    /** 브라우저 음성으로 내려간다. 정상 경로이므로 error 를 채우지 않는다. */
    const fallbackToBrowser = () => {
      const started = speakWithBrowserSynthesis(text, {
        onStart: () => {
          if (!owns()) return;
          setEngine('browser');
          setStatus('speaking');
        },
        onEnd: () => {
          if (!owns()) return;
          setStatus('idle');
        },
        onFailure: () => {
          if (!owns()) return;
          setStatus('error');
          setError('음성을 재생하지 못했습니다.');
        },
      });
      if (!started) {
        setStatus('error');
        setError('이 브라우저에서는 음성을 재생할 수 없습니다.');
      }
    };

    const playServerAudio = async (audioData: Blob) => {
      const objectUrl = URL.createObjectURL(audioData);
      objectUrlRef.current = objectUrl;

      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => {
        if (!owns()) return;
        releaseAudio();
        setStatus('idle');
      };
      audio.onerror = () => {
        if (!owns()) return;
        // WAV 를 못 읽는 경우. 소리는 나야 하므로 브라우저 음성으로 내려간다.
        releaseAudio();
        fallbackToBrowser();
      };

      try {
        await audio.play();
        if (!owns()) return;
        setEngine('server');
        setStatus('speaking');
      } catch {
        if (!owns()) return;
        // 자동재생 차단 등. 브라우저 합성도 같은 이유로 막힐 수 있지만 시도는 해 본다.
        releaseAudio();
        fallbackToBrowser();
      }
    };

    const run = async () => {
      // 응답이 영영 오지 않는 경우의 'loading' 무한 대기 방지. abort 로 깨어난 catch 는
      // 소유권이 남아 있으므로(= stop() 이 아님) 폴백으로 이어진다.
      const timeoutTimer = setTimeout(() => {
        if (!owns()) return;
        // 폴백이 조용하면 서버가 죽은 걸 아무도 모른다 — 실측 근거로도 남길 자리다.
        console.warn(
          `[speech] 서버 음성 응답이 ${SPEECH_REQUEST_TIMEOUT_MS}ms 안에 오지 않았습니다 — 브라우저 음성으로 폴백합니다.`,
        );
        controller.abort();
      }, SPEECH_REQUEST_TIMEOUT_MS);

      try {
        // 응답이 JSON 이 아니라 audio/wav 바이트라 parseAs: 'blob' 이다.
        // 요청 타입은 손으로 만들지 않는다 — 생성 스키마(SpeechRequest)가 body 를 검사한다.
        // emotion/style 은 생성 타입에서 필수라 태그가 없으면 서버 기본값과 같은 값을 채운다.
        const { data, response } = await api.POST('/api/v1/speech', {
          body: { text, emotion: emotion ?? 'neutral', style: style ?? 'normal' },
          parseAs: 'blob',
          signal: controller.signal,
        });

        if (!owns()) return;

        if (!response.ok) {
          // 503 = "이 서버로는 못 읽는다"(TTS 꺼짐 / vLLM-Omni 연결 실패). 예상된 신호다.
          // 그 밖의 상태코드(422 계약 위반 = 앱 버그, 5xx)는 조용히 넘기면 안 되니 로그로
          // 드러내되, 사용자 입장에서는 똑같이 소리가 나야 하므로 폴백은 동일하게 탄다.
          if (response.status !== 503) {
            console.warn(
              `[speech] 예상하지 못한 응답 ${response.status} — 브라우저 음성으로 폴백합니다.`,
            );
          }
          fallbackToBrowser();
          return;
        }

        // 빈 응답(Content-Length: 0 이면 openapi-fetch 가 data 를 undefined 로 준다)도
        // 재생할 것이 없으므로 폴백이다.
        if (!data || data.size === 0) {
          fallbackToBrowser();
          return;
        }

        await playServerAudio(data);
      } catch (cause) {
        // stop()/언마운트로 끊은 것이면 소유권이 이미 없다 — 정상 종료이니 아무것도 안 한다.
        if (!owns()) return;
        // 여기 남는 abort 는 위 타임아웃뿐이다. 네트워크 실패와 함께 폴백으로 보낸다.
        if (!isAbortError(cause)) {
          console.warn('[speech] 서버 음성 요청 실패 — 브라우저 음성으로 폴백합니다.', cause);
        }
        fallbackToBrowser();
      } finally {
        clearTimeout(timeoutTimer);
      }
    };

    void run();
  }, [emotion, releaseAudio, sentence, stop, style]);

  // 화면에 들어오면(문장·태그가 바뀌면) 한 번 읽고, 나갈 때 재생과 요청을 함께 끊는다.
  useEffect(() => {
    speak();
    return stop;
  }, [speak, stop]);

  return { status, engine, speak, stop, error };
}

/**
 * 서버 음성 요청의 응답 대기 상한.
 *
 * **프로토타입 임시값 — 확정 아님.** 서버는 자기 상한(`tts_timeout_seconds`, 현재 15초)에
 * 걸리면 503 으로 내려주고 그게 폴백 신호이므로, 클라이언트가 그보다 먼저 끊으면 그 신호를
 * 받지 못하고 매번 타임아웃 폴백이 된다. 그래서 서버 상한보다 여유를 둔 값으로 잡았다.
 * 원본 README 의 실측 latency 예시는 6.1초지만 이 레포에서 잰 값은 아직 없다 —
 * 실기기·실서버 실측 후 서버 값과 함께 조정한다.
 */
const SPEECH_REQUEST_TIMEOUT_MS = 20000;
