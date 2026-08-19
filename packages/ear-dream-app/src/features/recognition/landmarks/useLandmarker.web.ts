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
  SANE_COORD_LIMIT,
  delegateStartFromUrl,
  forgetGpuCorruptedVerdict,
  readGpuCorruptedVerdict,
  webglSupportsMediapipeGpu,
  rememberGpuCorruptedVerdict,
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
import { keepScreenAwake } from './wakeLock.web';

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
 * WebGL 컨텍스트를 붙일 캔버스를 새로 만든다(DOM 에 붙이지 않는다).
 *
 * tasks-vision 의 `VisionTaskOptions.canvas` 는 문서화된 공식 옵션이며, 지정하지 않으면
 * 라이브러리가 내부에서 캔버스를 만든다. **평상시에는 지정하지 않는다** — 아래 3단 폴백에서
 * GPU 생성이 실패했을 때만 쓴다(이유는 createLandmarkerTrio 호출부 주석 참고).
 *
 * 모델마다 따로 만든다. 한 캔버스를 셋이 공유하면 두 번째 태스크가 이미 초기화된 컨텍스트를
 * 만나게 되고, 그 조합은 검증한 적이 없다.
 */
function createWebglCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

/**
 * 손·얼굴·포즈 landmarker 를 같은 백엔드로 함께 만든다.
 * 일부만 성공하면 성공한 쪽을 닫는다 — 안 닫으면 WASM 힙에 그대로 남는다.
 *
 * `bindCanvas` 가 true 면 모델마다 빈 <canvas> 를 만들어 넘긴다(iOS WebView 워크어라운드).
 */
async function createLandmarkerTrio(
  vision: VisionRuntime,
  fileset: Awaited<ReturnType<typeof vision.FilesetResolver.forVisionTasks>>,
  delegate: LandmarkerDelegate,
  bindCanvas = false,
): Promise<[HandLandmarker, FaceLandmarker, PoseLandmarker]> {
  const [hand, face, pose] = await Promise.allSettled([
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_PATH, delegate },
      ...(bindCanvas ? { canvas: createWebglCanvas() } : null),
      // 양손 모두 검출한다. 어느 손을 쓸지 고르는 로직은 T-04.
      numHands: MAX_HANDS,
      runningMode: 'VIDEO',
      // 신뢰도 임계값은 의도적으로 지정하지 않는다(라이브러리 기본값 사용). config.ts 참고.
    }),
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_PATH, delegate },
      ...(bindCanvas ? { canvas: createWebglCanvas() } : null),
      numFaces: MAX_FACES,
      runningMode: 'VIDEO',
      // outputFaceBlendshapes 는 켜지 않는다. 표정 축약은 서버 전처리 소관이다. config.ts 참고.
    }),
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_LANDMARKER_MODEL_PATH, delegate },
      ...(bindCanvas ? { canvas: createWebglCanvas() } : null),
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
/**
 * 이 프레임의 좌표가 정규화 좌표로 말이 되는가.
 *
 * **생성 성공 = 정상 동작이 아니다.** 2026-08-19 실기기에서 GPU delegate 가 예외 없이
 * 만들어진 뒤 NaN 과 2.47e+35 를 뱉었다. 기존 폴백은 `createFromOptions` 가 던질 때만
 * 걸리므로 이 경우 아무것도 잡지 못했고, 쓰레기 좌표가 그대로 서버까지 갔다(422).
 *
 * 검출이 하나도 없는 프레임은 판단하지 않는다 — 손이 화면에 없는 정상 상황과 구분되지 않는다.
 */
function looksCorrupted(snapshot: LandmarkSnapshot): boolean {
  const points = [
    ...snapshot.hands.flatMap((hand) => hand.landmarks),
    ...(snapshot.face?.landmarks ?? []),
    ...(snapshot.pose?.landmarks ?? []),
  ];
  if (points.length === 0) return false;
  return points.some(
    (point) =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.abs(point.x) > SANE_COORD_LIMIT ||
      Math.abs(point.y) > SANE_COORD_LIMIT,
  );
}

/**
 * 이 프레임의 좌표를 한 줄로 요약한다 (정지 감지용). 검출이 없으면 null.
 *
 * 실기기에서 GPU 가 **같은 프레임을 계속 추론하는** 상태가 관측됐다 — 카메라를 돌려도
 * 어깨점 두 개가 허공에 붙박이고, 좌표는 0~1 범위의 멀쩡한 값이라 범위 검사로는 안 걸린다.
 * 그래서 "값이 변하는가" 를 따로 본다.
 */
function snapshotSignature(snapshot: LandmarkSnapshot): string | null {
  const parts: number[] = [];
  const first = snapshot.hands[0]?.landmarks[0];
  if (first) parts.push(first.x, first.y);
  const pose = snapshot.pose?.landmarks[0];
  if (pose) parts.push(pose.x, pose.y);
  const face = snapshot.face?.landmarks[0];
  if (face) parts.push(face.x, face.y);
  return parts.length === 0 ? null : parts.join(',');
}

/**
 * 이만큼의 프레임이 **완전히 같은 좌표**로 이어지면 백엔드가 멈춘 것으로 본다.
 *
 * 실제 카메라 입력에는 센서 노이즈가 있어 부동소수점 좌표가 연속으로 정확히 일치하는 일은
 * 사실상 없다. 사람이 가만히 있어도 마지막 자리가 흔들린다. 30 프레임(이 기기 기준 3초)은
 * 그 여유를 크게 잡은 값이다.
 */
const STUCK_FRAME_LIMIT = 30;

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
    delegate: optionDelegate = LANDMARKER_DELEGATE,
    onFrame,
  } = options;

  const urlStart = delegateStartFromUrl();
  // URL 로 지정했다는 건 사람이 직접 시험한다는 뜻이다. 저장된 판정이 그걸 가로막으면 안 된다.
  if (urlStart !== null) forgetGpuCorruptedVerdict();
  const urlDelegate: LandmarkerDelegate | null =
    urlStart === null ? null : urlStart === 'CPU' ? 'CPU' : 'GPU';

  /**
   * 쓰레기 좌표가 나왔을 때 밟는 단계.
   *
   * 'gpu' → 'gpu-canvas' → 'cpu' 순으로 내려간다. **중간 단계가 중요하다** — 기존 코드의
   * 명시 캔버스 워크어라운드(mediapipe#4499)는 `createFromOptions` 가 던질 때만 시도되는데,
   * 이 기기는 생성에 성공하고 출력만 깨지므로 한 번도 시도되지 않았다. 폰 CPU 로 3모델은
   * 느리니, CPU 로 내려가기 전에 그 워크어라운드를 한 번은 써 본다.
   *
   * 이미 판정이 남아 있는 기기는 처음부터 CPU 로 연다(초기화를 두 번 하지 않는다).
   * 단 `?delegate=` 를 준 경우에는 사람이 직접 시험하는 것이므로 판정을 무시한다.
   */
  const [attempt, setAttempt] = useState<'gpu' | 'gpu-canvas' | 'cpu'>(() => {
    if (urlStart === 'GPU_CANVAS') return 'gpu-canvas';
    if (urlStart !== null) return urlStart === 'CPU' ? 'cpu' : 'gpu';
    if (readGpuCorruptedVerdict()) return 'cpu';
    // float 렌더 타깃이 없으면 GPU 추론 결과를 읽어 올 수 없다 — 시도 자체를 건너뛴다.
    return webglSupportsMediapipeGpu() ? 'gpu' : 'cpu';
  });

  // 우선순위: URL 강제 > 오염 단계 > 호출자 지정 > 기본값
  const requestedDelegate: LandmarkerDelegate =
    urlDelegate ?? (attempt === 'cpu' ? 'CPU' : optionDelegate);
  const forceCanvas = attempt === 'gpu-canvas';

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
  // GPU 를 명시 캔버스로 되살렸는지. 개발 화면 HUD 표시용 — start() 안의 3단 폴백 주석 참고.
  const [gpuCanvasFallback, setGpuCanvasFallback] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setDisplay(EMPTY_DISPLAY);
      setActiveDelegate(null);
      setGpuCanvasFallback(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setError(
        window.isSecureContext === false
          ? // 실기기(폰)는 localhost 가 아니므로 https 가 유일한 길이다. 그래서 "localhost 로
            // 접속하라"만 안내하면 폰 사용자는 할 수 있는 일이 없다 — https 서빙 경로를 먼저 안내한다.
            '카메라는 보안 컨텍스트에서만 열립니다. 폰에서 보고 있다면 `pnpm serve:mobile` 이 띄운 https 주소로 접속하세요(README 「실기기 모바일 웹」). PC 라면 localhost 주소로 여세요.'
          : '이 브라우저에서는 카메라를 사용할 수 없습니다.',
      );
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    // 카메라가 도는 동안 화면이 잠들지 않게 한다. 지원하지 않는 환경에서는 no-op 다(wakeLock.web.ts).
    // 카메라 화면을 벗어나면 아래 cleanup 에서, 탭이 백그라운드로 가면 컨트롤러 내부에서 해제된다.
    const wakeLock = keepScreenAwake();
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
    // 추론 입력 프레임. <video> 를 직접 넘기지 않고 **우리가 그린 캔버스**를 넘긴다.
    //
    // 실기기 실측(2026-08-19): <video> 를 그대로 넘기면 돌아오는 정규화 좌표가 화면에 보이는
    // 영상과 다른 사각형을 기준으로 나왔다(오차 실측 x +0.069, y -0.053). 어떤 사각형을
    // 기준으로 정규화하는지는 브라우저 구현에 달려 있어 이쪽에서 통제할 수 없다.
    // 프레임을 직접 그려 넘기면 기준 사각형이 **우리가 정한 크기**로 확정된다 —
    // 그 크기를 그대로 sourceWidth/Height 로 싣고 오버레이도 같은 값으로 매핑한다.
    const inputCanvas = document.createElement('canvas');
    const inputContext = inputCanvas.getContext('2d', { willReadFrequently: false });
    let lastSignature: string | null = null;
    let stuckFrames = 0;
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
      //
      // 생성은 3단이다: GPU → GPU + 명시 캔버스 → CPU.
      //
      // 가운데 단계가 iOS WKWebView 워크어라운드다. 그쪽에서 MediaPipe 가
      // `emscripten_webgl_create_context() returned error 0` 으로 GPU 컨텍스트를 못 만드는
      // 사례가 보고돼 있고(google-ai-edge/mediapipe#4499), 빈 <canvas> 를 만들어
      // `createFromOptions` 에 넘기면 넘어간다는 워크어라운드가 함께 보고돼 있다.
      // `canvas` 는 tasks-vision 이 문서화한 공식 옵션(VisionTaskOptions)이다.
      //
      // ⚠️ 이 워크어라운드는 **실기기 iOS 에서 검증되지 않았다**(이 레포에 iOS 실측 수단이 없다).
      // 그래서 평상시 경로에 끼워 넣지 않고 **GPU 가 실패했을 때만** 시도한다 — GPU 가 되는
      // 환경(데스크톱 Chrome 등)의 동작은 이 변경 전과 완전히 동일하다. 안 되는 환경에서는
      // 어차피 다음 단계가 CPU 였고, 폰 CPU 로 3모델은 실용성이 의심스러우니 시도할 값이 있다.
      let delegate: LandmarkerDelegate = requestedDelegate;
      let canvasFallback = forceCanvas;
      try {
        [handLandmarker, faceLandmarker, poseLandmarker] = await createLandmarkerTrio(
          vision,
          fileset,
          delegate,
          forceCanvas,
        );
      } catch (cause) {
        // WebGL 을 못 쓰는 환경이 있을 수 있다. 백엔드 때문에 전체가 죽는 것보다 느려도 도는 게 낫다.
        if (delegate === 'CPU') throw cause;
        console.warn('GPU delegate 생성 실패, 명시 캔버스로 재시도합니다.', cause);
        try {
          [handLandmarker, faceLandmarker, poseLandmarker] = await createLandmarkerTrio(
            vision,
            fileset,
            delegate,
            true,
          );
          canvasFallback = true;
        } catch (canvasCause) {
          console.warn('명시 캔버스로도 GPU 생성 실패, CPU 로 폴백합니다.', canvasCause);
          delegate = 'CPU';
          [handLandmarker, faceLandmarker, poseLandmarker] = await createLandmarkerTrio(
            vision,
            fileset,
            delegate,
          );
        }
      }
      if (cancelled) {
        handLandmarker.close();
        faceLandmarker.close();
        poseLandmarker.close();
        return;
      }

      appliedDelegate = delegate;
      setActiveDelegate(delegate);
      setGpuCanvasFallback(canvasFallback);
      setStatus('running');
      rafId = requestAnimationFrame(tick);
    }

    function tick(): void {
      rafId = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!handLandmarker || !faceLandmarker || !poseLandmarker || !video || video.readyState < 2)
        return;
      if (video.videoWidth === 0) return;
      if (!inputContext) return;

      // 이 프레임을 추론 입력 캔버스로 복사한다. 이후 모든 좌표의 기준은 이 캔버스다.
      if (inputCanvas.width !== video.videoWidth || inputCanvas.height !== video.videoHeight) {
        inputCanvas.width = video.videoWidth;
        inputCanvas.height = video.videoHeight;
      }
      inputContext.drawImage(video, 0, 0, inputCanvas.width, inputCanvas.height);

      // 카메라가 아직 새 프레임을 주지 않았으면 같은 프레임을 다시 처리하지 않는다.
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const timestampMs = Math.round(performance.now());
      // 단조증가 가드. 이게 없으면 같은 ms 안에 두 번 호출될 때 MediaPipe 가 예외를 던진다.
      if (timestampMs <= lastTimestamp) return;
      lastTimestamp = timestampMs;

      const handStartedAt = performance.now();
      const handResult = handLandmarker.detectForVideo(inputCanvas, timestampMs);
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
        const faceResult = faceLandmarker.detectForVideo(inputCanvas, timestampMs);
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
      const poseResult = poseLandmarker.detectForVideo(inputCanvas, timestampMs);
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
        // 매 프레임 <video> 에서 실측한다 — 캐시하지 않는다.
        //
        // 이 값은 서버 전처리의 **입력값**이다(x_scale = (W/H) / (16/9)). 폰을 돌리면
        // videoWidth/Height 가 뒤바뀌는 브라우저가 있고, 그때 캐시된 값을 계속 실으면 좌표계가
        // 통째로 어긋난다. 그래서 방향 전환을 여기서 "처리" 하지 않고, 그냥 그 프레임의 실측값을
        // 그대로 싣는다. 세그먼트 안에서 이 값이 바뀌는 경우(= 프레임마다 좌표계가 다른 경우)는
        // useSegmentRecorder 가 감지해 그 세그먼트를 폐기한다.
        // 추론 입력 캔버스 크기 = 좌표의 기준 프레임. video.videoWidth 와 같은 값이지만
        // "좌표가 무엇을 기준으로 정규화됐는가" 를 싣는 것이므로 캔버스에서 읽는다.
        sourceWidth: inputCanvas.width,
        sourceHeight: inputCanvas.height,
        delegate: appliedDelegate,
      };

      // 백엔드가 쓰레기를 내고 있으면 여기서 끊는다. 아래로 흘려보내면 오버레이가 화면 밖에
      // 그려지고 세그먼트가 그대로 서버로 간다.
      // 정지 감지 — 값이 전혀 변하지 않으면 같은 이미지를 반복 추론하고 있는 것이다.
      const signature = snapshotSignature(snapshot);
      if (signature !== null && signature === lastSignature) stuckFrames += 1;
      else stuckFrames = 0;
      lastSignature = signature;

      const stuck = stuckFrames >= STUCK_FRAME_LIMIT;
      if (appliedDelegate !== 'CPU' && urlDelegate === null && (stuck || looksCorrupted(snapshot))) {
        const next = attempt === 'gpu' ? 'gpu-canvas' : 'cpu';
        console.warn(
          stuck
            ? `GPU delegate 가 ${STUCK_FRAME_LIMIT} 프레임 동안 같은 좌표만 냈습니다 (${attempt}) — ${next} 로 다시 만듭니다.`
            : `GPU delegate 가 정규화 범위를 벗어난 좌표를 냈습니다 (${attempt}) — ${next} 로 다시 만듭니다.`,
        );
        if (next === 'cpu') rememberGpuCorruptedVerdict();
        cancelAnimationFrame(rafId);
        setAttempt(next);
        return;
      }

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
      // 카메라가 안 열렸는데 화면만 계속 켜 두면 배터리만 먹는다. 재시도(enabled 토글) 시
      // 이 effect 가 다시 돌면서 새로 취득한다.
      wakeLock.release();
      if (cancelled) return;
      setStatus('error');
      setError(describeStartupError(cause));
    });

    return () => {
      cancelled = true;
      wakeLock.release();
      cancelAnimationFrame(rafId);
      handLandmarker?.close();
      faceLandmarker?.close();
      poseLandmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // delegate 는 모델 생성 시점에만 쓰이므로 바꾸려면 재시작이 필요하다.
    // faceEnabled / faceDetectEveryNFrames 와 달리 여기 들어가 있는 이유다.
  }, [enabled, requestedDelegate, forceCanvas, attempt, urlDelegate]);

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
    gpuCanvasFallback,
    sourceWidth: display.sourceWidth,
    sourceHeight: display.sourceHeight,
    videoRef,
  };
}
