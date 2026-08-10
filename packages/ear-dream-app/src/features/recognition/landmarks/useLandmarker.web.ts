/**
 * 랜드마크 추출 훅(손 + 얼굴 + 포즈) — 웹(브라우저 WASM) 구현.
 *
 * 이 파일만 MediaPipe 와 DOM 을 안다. 화면 쪽은 types.ts 의 계약만 보므로,
 * 나중에 네이티브 MediaPipe 나 서버 추론으로 갈아끼워도 UI 를 다시 짜지 않는다.
 *
 * UI 와 결합하지 않는다 — 그리는 방법은 소비하는 쪽 자유다.
 * 매 프레임 데이터가 필요하면 onFrame(리렌더 없음), 사람이 읽을 표시는 hands/face/fps(저빈도 갱신)를 쓴다.
 *
 * 왜 HolisticLandmarker 단일 모델을 쓰지 않는가
 *
 * Holistic 은 손·얼굴·포즈를 한 번에 주지만, 손을 leftHandLandmarks / rightHandLandmarks 로
 * **이미 좌우로 갈라서** 내보내고 handedness score 를 주지 않는다. 그런데 지금 이 단계의 핵심
 * 미측정 항목이 바로 그 좌우 라벨이다(handedness.ts 참고). 갈라주는 모델을 쓰면 검증해야 할 값이
 * 모델 안으로 숨어버려서, 틀렸을 때 확인할 방법이 없어진다. 게다가 쓰지도 않는 포즈 모델을
 * 함께 지고 간다. 손+얼굴 두 모델을 따로 두면 각각의 처리 비용도 따로 잴 수 있다.
 */
import type { FaceLandmarker, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState } from 'react';

import type { HandFrame } from '@ear-dream/core';

import {
  CAMERA_CONSTRAINTS_HINT,
  FACE_DETECT_EVERY_N_FRAMES,
  FACE_LANDMARKER_MODEL_PATH,
  FPS_SAMPLE_WINDOW,
  HAND_LANDMARKER_MODEL_PATH,
  HUD_UPDATE_INTERVAL_MS,
  LANDMARKER_DELEGATE,
  MAX_FACES,
  MAX_HANDS,
  MAX_POSES,
  MEDIAPIPE_WASM_PATH,
  POSE_LANDMARKER_MODEL_PATH,
} from './config';
import type {
  DetectedFace,
  DetectedHand,
  DetectedPose,
  FaceFrame,
  LandmarkerDelegate,
  LandmarkerStatus,
  LandmarkSnapshot,
  LandmarkTimings,
  UseLandmarkerOptions,
  UseLandmarkerResult,
} from './types';
import type { VisionRuntime } from './visionRuntime.web';
import { loadVisionRuntime } from './visionRuntime.web';

/** 웹 구현은 붙일 <video> 엘리먼트가 필요하다. 이 ref 를 <video> 에 그대로 넘긴다. */
export interface WebLandmarkerResult extends UseLandmarkerResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface DisplayState {
  hands: readonly DetectedHand[];
  face: DetectedFace | null;
  displayFace: DetectedFace | null;
  pose: DetectedPose | null;
  fps: number;
  timings: LandmarkTimings;
  sourceWidth: number;
  sourceHeight: number;
}

const NO_TIMINGS: LandmarkTimings = { handDetectMs: 0, faceDetectMs: 0, poseDetectMs: 0 };

const EMPTY_DISPLAY: DisplayState = {
  hands: [],
  face: null,
  displayFace: null,
  pose: null,
  fps: 0,
  timings: NO_TIMINGS,
  sourceWidth: 0,
  sourceHeight: 0,
};

/**
 * 손·얼굴·포즈 landmarker 를 같은 백엔드로 함께 만든다.
 * 일부만 성공하면 성공한 쪽을 닫는다 — 안 닫으면 WASM 힙에 그대로 남는다.
 */
async function createLandmarkerTrio(
  vision: VisionRuntime,
  fileset: Awaited<ReturnType<typeof vision.FilesetResolver.forVisionTasks>>,
  delegate: LandmarkerDelegate,
): Promise<[HandLandmarker, FaceLandmarker, PoseLandmarker]> {
  const [hand, face, pose] = await Promise.allSettled([
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_PATH, delegate },
      // 양손 모두 검출한다. 어느 손을 쓸지 고르는 로직은 T-04.
      numHands: MAX_HANDS,
      runningMode: 'VIDEO',
      // 신뢰도 임계값은 의도적으로 지정하지 않는다(라이브러리 기본값 사용). config.ts 참고.
    }),
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_PATH, delegate },
      numFaces: MAX_FACES,
      runningMode: 'VIDEO',
      // outputFaceBlendshapes 는 켜지 않는다. 표정 축약은 서버 전처리 소관이다. config.ts 참고.
    }),
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_LANDMARKER_MODEL_PATH, delegate },
      numPoses: MAX_POSES,
      runningMode: 'VIDEO',
      // outputSegmentationMasks 는 켜지 않는다. 좌표만 필요하고 마스크는 추가 비용이다.
    }),
  ]);

  if (hand.status === 'fulfilled' && face.status === 'fulfilled' && pose.status === 'fulfilled') {
    return [hand.value, face.value, pose.value];
  }
  if (hand.status === 'fulfilled') hand.value.close();
  if (face.status === 'fulfilled') face.value.close();
  if (pose.status === 'fulfilled') pose.value.close();
  const failed = [hand, face, pose].find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  throw failed?.reason ?? new Error('landmarker 생성 실패');
}

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
  return `랜드마크 추출 초기화에 실패했습니다. WASM/모델 파일이 없으면 \`pnpm setup:mediapipe\` 를 실행하세요. (${message})`;
}

/** 최근 FPS_SAMPLE_WINDOW 개의 이동평균. 표본이 없으면 0. */
function pushSample(samples: number[], value: number): number {
  samples.push(value);
  if (samples.length > FPS_SAMPLE_WINDOW) samples.shift();
  return samples.reduce((sum, v) => sum + v, 0) / samples.length;
}

export function useLandmarker(options: UseLandmarkerOptions = {}): WebLandmarkerResult {
  const {
    enabled = true,
    faceEnabled = true,
    faceDetectEveryNFrames = FACE_DETECT_EVERY_N_FRAMES,
    delegate: requestedDelegate = LANDMARKER_DELEGATE,
    onFrame,
  } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // onFrame 은 ref 로 들고 있는다. 소비하는 쪽이 인라인 함수를 넘겨도 검출 루프가 재시작되지 않는다.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // 얼굴 관련 옵션도 ref 로 읽는다. 이유는 성능이 아니라 측정의 타당성이다 —
  // 얼굴을 껐다 켤 때마다 카메라와 모델이 재시작되면 조명·노출·해상도가 달라져서
  // "손만" 과 "손+얼굴" 의 FPS 비교가 성립하지 않는다. 같은 세션 안에서 토글해야 한다.
  const faceEnabledRef = useRef(faceEnabled);
  faceEnabledRef.current = faceEnabled;
  const faceIntervalRef = useRef(1);
  faceIntervalRef.current = Math.max(1, Math.round(faceDetectEveryNFrames));

  const [status, setStatus] = useState<LandmarkerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState<DisplayState>(EMPTY_DISPLAY);
  // 요청값이 아니라 실제로 적용된 백엔드. 폴백이 일어나면 요청값과 달라진다.
  const [activeDelegate, setActiveDelegate] = useState<LandmarkerDelegate | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setDisplay(EMPTY_DISPLAY);
      setActiveDelegate(null);
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
    let handLandmarker: HandLandmarker | null = null;
    let faceLandmarker: FaceLandmarker | null = null;
    let poseLandmarker: PoseLandmarker | null = null;

    // MediaPipe 는 VIDEO 모드에서 타임스탬프가 단조증가하기를 요구한다.
    // 같은 값을 두 번 넣으면 예외를 던지므로 아래 루프에서 반드시 t > lastTimestamp 로 막는다.
    // (얼굴을 건너뛰는 프레임이 있어도 값이 줄지는 않으므로 이 조건은 그대로 유효하다.)
    let lastTimestamp = -1;
    // 같은 프레임을 두 번 처리하지 않기 위한 값. 카메라가 새 프레임을 주기 전에는 건너뛴다.
    let lastVideoTime = -1;

    const frameDurations: number[] = [];
    const handDurations: number[] = [];
    const faceDurations: number[] = [];
    const poseDurations: number[] = [];
    let handDetectMs = 0;
    let faceDetectMs = 0;
    let poseDetectMs = 0;
    let previousFrameAt = 0;
    let lastHudAt = 0;

    // 화면 표시 전용으로 들고 있는 직전 얼굴. 스냅샷의 face(관측값)와 절대 섞지 않는다.
    let heldFace: DetectedFace | null = null;
    let processedFrames = 0;
    // 실제로 적용된 백엔드(GPU 폴백 반영). 스냅샷마다 실어 캡처 메타로 흘러간다.
    let appliedDelegate: LandmarkerDelegate = requestedDelegate;

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

      // 세 모델은 항상 함께 만든다. faceEnabled 는 "이번 프레임에 부를지" 만 정한다 —
      // 토글할 때마다 모델을 만들고 닫으면 그 비용이 측정하려는 FPS 에 섞여 들어간다.
      let delegate: LandmarkerDelegate = requestedDelegate;
      try {
        [handLandmarker, faceLandmarker, poseLandmarker] = await createLandmarkerTrio(
          vision,
          fileset,
          delegate,
        );
      } catch (cause) {
        // WebGL 을 못 쓰는 환경이 있을 수 있다. 백엔드 때문에 전체가 죽는 것보다 느려도 도는 게 낫다.
        if (delegate === 'CPU') throw cause;
        console.warn('GPU delegate 생성 실패, CPU 로 폴백합니다.', cause);
        delegate = 'CPU';
        [handLandmarker, faceLandmarker, poseLandmarker] = await createLandmarkerTrio(
          vision,
          fileset,
          delegate,
        );
      }
      if (cancelled) {
        handLandmarker.close();
        faceLandmarker.close();
        poseLandmarker.close();
        return;
      }

      appliedDelegate = delegate;
      setActiveDelegate(delegate);
      setStatus('running');
      rafId = requestAnimationFrame(tick);
    }

    function tick(): void {
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!handLandmarker || !faceLandmarker || !poseLandmarker || !video || video.readyState < 2)
        return;
      if (video.videoWidth === 0) return;

      // 카메라가 아직 새 프레임을 주지 않았으면 같은 프레임을 다시 처리하지 않는다.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const timestampMs = Math.round(performance.now());
      // 단조증가 가드. 이게 없으면 같은 ms 안에 두 번 호출될 때 MediaPipe 가 예외를 던진다.
      if (timestampMs <= lastTimestamp) return;
      lastTimestamp = timestampMs;

      const handStartedAt = performance.now();
      const handResult = handLandmarker.detectForVideo(video, timestampMs);
      handDetectMs = pushSample(handDurations, performance.now() - handStartedAt);

      const hands: DetectedHand[] = handResult.landmarks.map((landmarks, index) => {
        // handedness 라벨은 원본 그대로 전달한다. 여기서 뒤집거나 보정하지 않는다 — handedness.ts 참고.
        const category = handResult.handedness[index]?.[0];
        const frame: HandFrame = landmarks.map((point) => [point.x, point.y, point.z]);

        return {
          handednessLabel: category?.categoryName ?? 'Unknown',
          handednessScore: category?.score ?? 0,
          landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          frame,
        };
      });

      // 얼굴은 같은 프레임 · 같은 타임스탬프로 처리한다. 손과 얼굴이 서로 다른 시점의 것이면
      // 이후 시간창을 만들 때(T-08) 손 동작과 표정이 어긋난 채로 쌓인다.
      const faceOn = faceEnabledRef.current;
      const faceDue = processedFrames % faceIntervalRef.current === 0;
      // 이 프레임의 관측값. 검출을 건너뛰었거나 얼굴이 없으면 null 로 남는다.
      // null 을 직전 값으로 메우지 않는다 — 그건 대치이고 서버 몫이다(types.ts 의 face 주석 참고).
      let face: DetectedFace | null = null;

      if (!faceOn) {
        heldFace = null;
        faceDurations.length = 0;
        faceDetectMs = 0;
      } else if (faceDue) {
        const faceStartedAt = performance.now();
        const faceResult = faceLandmarker.detectForVideo(video, timestampMs);
        faceDetectMs = pushSample(faceDurations, performance.now() - faceStartedAt);

        const landmarks = faceResult.faceLandmarks[0];
        if (landmarks) {
          const frame: FaceFrame = landmarks.map((point) => [point.x, point.y, point.z]);
          face = {
            landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
            frame,
          };
        }
        // 얼굴이 프레임 밖으로 나갔으면 표시값도 지운다. 안 그러면 없는 얼굴이 계속 그려진다.
        heldFace = face;
      }

      // 포즈는 손·얼굴과 같은 프레임 · 같은 타임스탬프로 매번 처리한다. 시점이 어긋나면
      // 세그먼트를 만들 때 손 동작과 어깨 위치가 어긋난 채로 쌓인다.
      const poseStartedAt = performance.now();
      const poseResult = poseLandmarker.detectForVideo(video, timestampMs);
      poseDetectMs = pushSample(poseDurations, performance.now() - poseStartedAt);

      // 이 프레임의 관측값. 검출 실패면 null 로 남긴다 — 직전 값으로 메우지 않는다(face 와 같은 원칙).
      let pose: DetectedPose | null = null;
      const poseLandmarks = poseResult.landmarks[0];
      if (poseLandmarks) {
        pose = {
          landmarks: poseLandmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          visibility: poseLandmarks.map((point) => point.visibility),
          worldLandmarks:
            poseResult.worldLandmarks[0]?.map((point) => [point.x, point.y, point.z]) ?? null,
          frame: poseLandmarks.map((point) => [point.x, point.y, point.z]),
        };
      }

      processedFrames += 1;

      const snapshot: LandmarkSnapshot = {
        hands,
        face,
        displayFace: heldFace,
        pose,
        fps: measureFps(timestampMs),
        timings: { handDetectMs, faceDetectMs, poseDetectMs },
        timestampMs,
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
        delegate: appliedDelegate,
      };

      onFrameRef.current?.(snapshot);

      // 사람이 읽는 표시는 저빈도로만 갱신한다. 매 프레임 리렌더하면 측정하려는 FPS 가 오염된다.
      if (timestampMs - lastHudAt >= HUD_UPDATE_INTERVAL_MS) {
        lastHudAt = timestampMs;
        setDisplay({
          hands: snapshot.hands,
          face: snapshot.face,
          displayFace: snapshot.displayFace,
          pose: snapshot.pose,
          fps: snapshot.fps,
          timings: snapshot.timings,
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
      handLandmarker?.close();
      faceLandmarker?.close();
      poseLandmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // delegate 는 모델 생성 시점에만 쓰이므로 바꾸려면 재시작이 필요하다.
    // faceEnabled / faceDetectEveryNFrames 와 달리 여기 들어가 있는 이유다.
  }, [enabled, requestedDelegate]);

  return {
    status,
    error,
    hands: display.hands,
    face: display.face,
    displayFace: display.displayFace,
    pose: display.pose,
    fps: display.fps,
    timings: display.timings,
    delegate: activeDelegate,
    sourceWidth: display.sourceWidth,
    sourceHeight: display.sourceHeight,
    videoRef,
  };
}
