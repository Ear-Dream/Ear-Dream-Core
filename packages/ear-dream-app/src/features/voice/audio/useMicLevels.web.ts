/**
 * 마이크 레벨 훅 — 웹(Web Audio) 구현.
 *
 * getUserMedia → AnalyserNode 의 시간축 데이터를 막대 개수만큼 구간으로 잘라 구간별 RMS 를
 * 진폭으로 쓴다. 주파수 스펙트럼(이퀄라이저)이 아니라 시간축을 쓰는 이유는 "무음이면 일자,
 * 소리가 나면 그 소리만큼"이 그대로 나오는 게 시간축이기 때문이다.
 *
 * 브라우저 기본 API만 쓴다 — 새 의존성 없음.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import type { MicLevelStatus, UseMicLevelsResult } from './types';

export function useMicLevels(active: boolean, barCount: number): UseMicLevelsResult {
  const amplitudesRef = useRef<Animated.Value[] | null>(null);
  if (amplitudesRef.current === null || amplitudesRef.current.length !== barCount) {
    amplitudesRef.current = Array.from({ length: barCount }, () => new Animated.Value(0));
  }
  const amplitudes = amplitudesRef.current;

  const [status, setStatus] = useState<MicLevelStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      setError(null);
      amplitudes.forEach((value) => value.setValue(0));
      return;
    }

    const AudioContextCtor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext);

    if (!AudioContextCtor || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError('이 브라우저에서는 마이크 파형을 표시할 수 없습니다.');
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;

    setStatus('requesting');
    setError(null);

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(async (granted) => {
        if (stopped) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;

        const audio = new AudioContextCtor();
        context = audio;
        // 사용자 제스처 없이 만들어지면 suspended 로 시작할 수 있다(자동재생 정책).
        if (audio.state === 'suspended') await audio.resume();
        if (stopped) return;

        const analyser = audio.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        // 마이크를 destination 에 연결하지 않는다 — 연결하면 스피커로 되돌아나가 하울링이 난다.
        audio.createMediaStreamSource(granted).connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);
        const segment = Math.floor(samples.length / barCount);
        const smoothed = new Float32Array(barCount);

        setStatus('listening');

        const tick = () => {
          analyser.getByteTimeDomainData(samples);

          for (let bar = 0; bar < barCount; bar += 1) {
            const start = bar * segment;
            let sumOfSquares = 0;
            for (let i = 0; i < segment; i += 1) {
              // 8bit PCM 은 128 이 무음. -1 ~ 1 로 옮긴다.
              const deviation = (samples[start + i]! - 128) / 128;
              sumOfSquares += deviation * deviation;
            }
            const rms = Math.sqrt(sumOfSquares / segment);

            // 노이즈 플로어 아래는 통째로 0 — 조용할 때 파형이 미세하게 떨지 않고 일자로 눕는다.
            const above = Math.max(0, rms - NOISE_FLOOR) / (1 - NOISE_FLOOR);
            const target = Math.min(1, above * GAIN);

            // 붙을 땐 빠르게, 떨어질 땐 천천히. 말소리가 끊겨 보이지 않게 한다.
            const previous = smoothed[bar]!;
            const coefficient = target > previous ? ATTACK : RELEASE;
            const next = previous + (target - previous) * coefficient;

            smoothed[bar] = next;
            amplitudes[bar]!.setValue(next);
          }

          frame = requestAnimationFrame(tick);
        };

        frame = requestAnimationFrame(tick);
      })
      .catch((cause: unknown) => {
        if (stopped) return;
        const name = cause instanceof Error ? cause.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied');
          setError('마이크 권한이 필요합니다.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('error');
          setError('사용할 수 있는 마이크를 찾지 못했습니다.');
        } else {
          setStatus('error');
          setError('마이크를 열지 못했습니다.');
        }
      });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => {
        // 이미 닫힌 컨텍스트 — 무시한다.
      });
      amplitudes.forEach((value) => value.setValue(0));
    };
  }, [active, barCount, amplitudes]);

  return { amplitudes, status, error };
}

/**
 * 아래 수치는 조용한 실내에서 말할 때 파형이 자연스럽게 보이도록 맞춘 값이다.
 * 실사용 환경(데모장 소음)에서 재조정이 필요할 수 있다 — 확정값이 아니다.
 */
/** 시간축 샘플 수. 막대 17개로 나눠도 구간당 60샘플 이상 남는다. */
const FFT_SIZE = 1024;
/** 이 RMS 아래는 무음으로 본다. */
const NOISE_FLOOR = 0.015;
/** 말소리 RMS(대략 0.05~0.2)를 화면 전체 높이로 펼치기 위한 배율. */
const GAIN = 3.2;
const ATTACK = 0.55;
const RELEASE = 0.12;
