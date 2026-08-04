/**
 * 손 랜드마크 추출 훅 — 웹(브라우저 WASM) 구현.
 *
 * 이 파일만 MediaPipe 와 DOM 을 안다. 화면 쪽은 types.ts 의 계약만 보므로,
 * 나중에 네이티브 MediaPipe 나 서버 추론으로 갈아끼워도 UI 를 다시 짜지 않는다.
 *
 * UI 와 결합하지 않는다 — 그리는 방법은 소비하는 쪽 자유다.
 * 매 프레임 데이터가 필요하면 onFrame(리렌더 없음), 사람이 읽을 표시는 hands/fps(저빈도 갱신)를 쓴다.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState } from 'react';

import type { HandFrame } from '@ear-dream/core';

import {
  CAMERA_CONSTRAINTS_HINT,
  FPS_SAMPLE_WINDOW,
  HAND_LANDMARKER_MODEL_PATH,
  HUD_UPDATE_INTERVAL_MS,
  MAX_HANDS,
  MEDIAPIPE_WASM_PATH,
} from './config';
import type {
  DetectedHand,
  HandLandmarkerStatus,
  HandLandmarkSnapshot,
  UseHandLandmarkerOptions,
  UseHandLandmarkerResult,
} from './types';
import { loadVisionRuntime } from './visionRuntime.web';

/** 웹 구현은 붙일 <video> 엘리먼트가 필요하다. 이 ref 를 <video> 에 그대로 넘긴다. */
export interface WebHandLandmarkerResult extends UseHandLandmarkerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface DisplayState {
  hands: readonly DetectedHand[];
  fps: number;
  sourceWidth: number;
  sourceHeight: number;
}

const EMPTY_DISPLAY: DisplayState = { hands: [], fps: 0, sourceWidth: 0, sourceHeight: 0 };

function describeStartupError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '카메라 권한이 거부되었습니다. 브라우저 주소창의 권한 아이콘에서 허용으로 바꾼 뒤 새로고침하세요.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '사용할 수 있는 카메라를 찾지 못했습니다. 카메라가 연결되어 있는지 확인하세요.';
  }
  if (name === 'NotReadableError') {
    return '다른 앱이 카메라를 사용 중입니다. 해당 앱을 종료한 뒤 새로고침하세요.';
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  return `손 인식 초기화에 실패했습니다. WASM/모델 파일이 없으면 \`pnpm setup:mediapipe\` 를 실행하세요. (${message})`;
}

export function useHandLandmarker(options: UseHandLandmarkerOptions = {}): WebHandLandmarkerResult {
  const { enabled = true, onFrame } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // onFrame 은 ref 로 들고 있는다. 소비하는 쪽이 인라인 함수를 넘겨도 검출 루프가 재시작되지 않는다.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [status, setStatus] = useState<HandLandmarkerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<DisplayState>(EMPTY_DISPLAY);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setDisplay(EMPTY_DISPLAY);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError(
        window.isSecureContext === false
          ? '카메라는 보안 컨텍스트(https 또는 localhost)에서만 쓸 수 있습니다. localhost 주소로 접속하세요.'
          : '이 브라우저에서는 카메라를 사용할 수 없습니다.',
      );
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    // MediaPipe 는 VIDEO 모드에서 타임스탬프가 단조증가하기를 요구한다.
    // 같은 값을 두 번 넣으면 예외를 던지므로 아래 루프에서 반드시 t > lastTimestamp 로 막는다.
    let lastTimestamp = -1;
    // 같은 프레임을 두 번 처리하지 않기 위한 값. 카메라가 새 프레임을 주기 전에는 건너뛴다.
    let lastVideoTime = -1;

    const frameDurations: number[] = [];
    let previousFrameAt = 0;
    let lastHudAt = 0;

    function measureFps(now: number): number {
      if (previousFrameAt > 0) {
        frameDurations.push(now - previousFrameAt);
        if (frameDurations.length > FPS_SAMPLE_WINDOW) frameDurations.shift();
      }
      previousFrameAt = now;

      if (frameDurations.length === 0) return 0;
      const mean = frameDurations.reduce((sum, d) => sum + d, 0) / frameDurations.length;
      return mean > 0 ? 1000 / mean : 0;
    }

    async function start(): Promise<void> {
      setStatus('loading');
      setError(null);

      stream = await navigator.mediaDevices.getUserMedia({
        video: CAMERA_CONSTRAINTS_HINT,
        audio: false,
      });
      if (cancelled) return;

      const video = videoRef.current;
      if (!video) throw new Error('<video> 엘리먼트가 아직 연결되지 않았습니다.');

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (cancelled) return;

      // 라이브러리 본체는 번들이 아니라 런타임에 읽는다. 이유는 visionRuntime.web.ts 참고.
      const vision = await loadVisionRuntime();
      if (cancelled) return;

      // WASM 과 모델은 같은 오리진의 public/ 에서만 읽는다. CDN 을 쓰지 않는 이유는 config.ts 참고.
      const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
      if (cancelled) return;

      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_PATH },
        // 양손 모두 검출한다. 어느 손을 쓸지 고르는 로직은 T-04.
        numHands: MAX_HANDS,
        runningMode: 'VIDEO',
        // 신뢰도 임계값은 의도적으로 지정하지 않는다(라이브러리 기본값 사용). config.ts 참고.
      });
      if (cancelled) return;

      setStatus('running');
      rafId = requestAnimationFrame(tick);
    }

    function tick(): void {
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!landmarker || !video || video.readyState < 2 || video.videoWidth === 0) return;

      // 카메라가 아직 새 프레임을 주지 않았으면 같은 프레임을 다시 처리하지 않는다.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const timestampMs = Math.round(performance.now());
      // 단조증가 가드. 이게 없으면 같은 ms 안에 두 번 호출될 때 MediaPipe 가 예외를 던진다.
      if (timestampMs <= lastTimestamp) return;
      lastTimestamp = timestampMs;

      const result = landmarker.detectForVideo(video, timestampMs);

      const hands: DetectedHand[] = result.landmarks.map((landmarks, index) => {
        // handedness 라벨은 원본 그대로 전달한다. 여기서 뒤집거나 보정하지 않는다 — handedness.ts 참고.
        const category = result.handedness[index]?.[0];
        const frame: HandFrame = landmarks.map((point) => [point.x, point.y, point.z]);

        return {
          handednessLabel: category?.categoryName ?? 'Unknown',
          handednessScore: category?.score ?? 0,
          landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          frame,
        };
      });

      const snapshot: HandLandmarkSnapshot = {
        hands,
        fps: measureFps(timestampMs),
        timestampMs,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
      };

      onFrameRef.current?.(snapshot);

      // 사람이 읽는 표시는 저빈도로만 갱신한다. 매 프레임 리렌더하면 측정하려는 FPS 가 오염된다.
      if (timestampMs - lastHudAt >= HUD_UPDATE_INTERVAL_MS) {
        lastHudAt = timestampMs;
        setDisplay({
          hands: snapshot.hands,
          fps: snapshot.fps,
          sourceWidth: snapshot.sourceWidth,
          sourceHeight: snapshot.sourceHeight,
        });
      }
    }

    start().catch((cause: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setError(describeStartupError(cause));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled]);

  return {
    status,
    error,
    hands: display.hands,
    fps: display.fps,
    sourceWidth: display.sourceWidth,
    sourceHeight: display.sourceHeight,
    videoRef,
  };
}
