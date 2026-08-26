/**
 * 랜드마크 추출 설정값.
 *
 * 여기 있는 값 중 제품 사양으로 확정된 것은 하나도 없다. 목표 FPS, 허용 지연, 신뢰도 임계값,
 * 시간창 프레임 수는 실측과 사용자 검증 전까지 정해지지 않았다. 그럴듯한 숫자를 코드에 박아
 * 확정된 것처럼 보이게 하지 않기 위해, 필요한 값만 상수로 두고 근거를 함께 남긴다.
 */

/** MVP 제약상 손은 최대 2개. T-03 은 양손 모두 검출하고 선택은 하지 않는다(T-04). */
export const MAX_HANDS = 2;

/**
 * 얼굴은 1개만 검출한다.
 * 입력은 사용자 본인의 비수지신호(눈썹·시선·입모양·고개)이지 대화 상대의 얼굴이 아니다.
 * 셀프카메라에 상대 얼굴이 함께 잡히는 상황은 MVP 범위 밖이다.
 */
export const MAX_FACES = 1;

/**
 * 포즈는 1개만 검출한다. 필요한 것은 사용자 본인의 어깨 양 포인트(어깨 기준 정규화)이지
 * 다른 사람의 포즈가 아니다. MAX_FACES 와 같은 논리다.
 */
export const MAX_POSES = 1;

/** FPS 이동평균 표본 수. 작업 지시서에 명시된 값(최근 30프레임)이라 임의값이 아니다. */
export const FPS_SAMPLE_WINDOW = 30;

/**
 * HUD(FPS, handedness 라벨) 리렌더 주기.
 * 제품 사양이 아니라 화면 표시 갱신 주기다. 숫자가 너무 빨리 바뀌면 육안으로 읽을 수 없고,
 * 매 프레임 리렌더하면 측정하려는 FPS 자체가 리렌더 비용에 오염된다.
 */
export const HUD_UPDATE_INTERVAL_MS = 250;

/**
 * 얼굴 검출 주기(프레임 단위). 1 이면 손과 같은 프레임에서 매번 처리한다.
 *
 * 이 기본값 1 은 튜닝 결과가 아니라 "아직 측정하지 않았다" 는 뜻이다.
 * 얼굴을 추가하면 프레임 처리율이 떨어지고, 표정은 손보다 천천히 변하므로 얼굴만 더 낮은
 * 주기로 뽑는 선택지가 있다. 다만 그 판단은 실측이 먼저다 — 개발 화면에서 이 값을 바꿔가며
 * FPS 와 단계별 처리 시간을 비교할 수 있게 해 두었다. 근거가 생기면 그때 이 값을 올린다.
 */
export const FACE_DETECT_EVERY_N_FRAMES = 1;

/**
 * 추론 백엔드. tasks-vision 의 기본값은 CPU 라서 명시하지 않으면 CPU 로 돈다.
 *
 * 이 값이 중요한 이유는 성능 자체가 아니라 **측정의 타당성**이다. T-03 의 산출물은 설계 문서의
 * `TARGET_FPS` 를 정할 FPS 수치인데, 출하 구성과 다른 백엔드로 잰 숫자는 근거가 되지 못한다.
 * CPU 로 재면 얼굴 추가가 실제보다 훨씬 무거워 보이고, 그 결과 필요 없는 프레임 스킵을 켜게 된다.
 *
 * 개발 환경(M3 Pro / Chrome, 1280x720) 실측:
 *   CPU  손 24.9ms + 얼굴 16.6ms = 41.5ms  (약 24fps 천장)
 *   GPU  손  5.2ms + 얼굴  2.6ms          (둘을 동시에 띄워 번갈아 호출 시 13.2ms, 약 76fps 천장)
 * ⚠️ 이건 개발용 Mac 값이지 실기기 값이 아니다. 실기기 수치는 여전히 미측정이다.
 *
 * GPU 생성이 실패하면 CPU 로 자동 폴백한다(WebGL 이 없는 환경이 있을 수 있다).
 * 어느 쪽으로 돌고 있는지는 개발 화면 HUD 에 표시된다 — 백엔드를 모르는 FPS 기록은 쓸모가 없다.
 */
export const LANDMARKER_DELEGATE = 'GPU' as const;

/**
 * 정규화 좌표로 인정할 절댓값 상한.
 *
 * MediaPipe 정규화 좌표는 0~1 이지만 랜드마크가 프레임 밖으로 나가면 조금 넘거나 음수가
 * 될 수 있다. 그래서 딱 0~1 로 자르지 않고 여유를 크게 둔다 — 여기서 가려내려는 것은
 * "살짝 벗어난 값" 이 아니라 **초기화되지 않은 메모리를 float 으로 읽은 값**이다
 * (실기기 실측: 2.47e+35, NaN). 둘은 자릿수가 달라 헷갈릴 일이 없다.
 */
export const SANE_COORD_LIMIT = 10;

/**
 * `?delegate=cpu` 로 추론 백엔드를 강제한다 (웹 전용, 없으면 null).
 *
 * 실기기에서 GPU/CPU 를 가르는 데 재빌드가 필요하면 A/B 를 안 하게 된다. 2026-08-19
 * 실기기 테스트에서 GPU 가 쓰레기 좌표를 내는 기기가 실제로 나왔고, 그때 폰에서 즉시
 * 갈아 끼울 수단이 없었다. 자동 폴백(useLandmarker)이 이 상황을 스스로 처리하지만,
 * 원인을 사람이 확인하려면 강제 스위치가 따로 있어야 한다.
 */
/**
 * 이 기기의 WebGL 이 MediaPipe GPU 추론을 감당하는가.
 *
 * MediaPipe 의 GPU 경로는 **32비트 float 렌더 타깃**에 텐서를 쓰고 되읽는다. WebGL2 에서
 * 그걸 허용하는 게 `EXT_color_buffer_float` 인데, 이게 없는 기기에서는 프레임버퍼가
 * incomplete 가 되어 추론은 도는 듯하면서 **읽어 온 값이 쓰레기**가 된다
 * (실측 2026-08-19, 삼성 안드로이드: 좌표 2.47e+35 · NaN, 명시 캔버스 경로에서는 값 고정.
 *  같은 증상이 mediapipe#5190 · #2141 에 보고돼 있고 아직 미해결이다).
 *
 * 런타임 오염 감지(useLandmarker)가 이 상황을 결국 잡아내지만, 그때는 이미 초기화를 두 번
 * 돌린 뒤다 — 카메라 준비가 그만큼 길어지고 나쁜 좌표가 잠깐 흐른다. 미리 걸러 그 창을 없앤다.
 *
 * ⚠️ 이 확장이 없다고 GPU 가 반드시 깨진다고 단정할 근거는 우리 실측 한 대뿐이다. 그래서
 * 이건 **기본 경로의 지름길**일 뿐이고, `?delegate=gpu` 로는 여전히 강제로 시험할 수 있다.
 */
export function webglSupportsMediapipeGpu(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const supported = gl.getExtension('EXT_color_buffer_float') !== null;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // 판정용 컨텍스트를 남기지 않는다
    return supported;
  } catch {
    return false; // 판정 자체가 안 되면 안전한 쪽(CPU)으로 간다
  }
}

const CORRUPT_VERDICT_KEY = 'ear-dream.gpu-corrupted';

/**
 * "이 기기의 GPU 는 쓰레기 좌표를 낸다" 는 판정을 기기에 남긴다.
 *
 * 남기지 않으면 페이지를 열 때마다 GPU 로 시작했다가 오염을 확인하고 다시 만든다 —
 * landmarker 3개 생성과 카메라 협상이 두 번 도니까 "카메라 준비중" 이 그만큼 길어진다.
 * 한 번 겪은 기기는 다음부터 바로 CPU 로 연다. `?delegate=gpu` 로 언제든 다시 시험할 수 있다.
 */
export function readGpuCorruptedVerdict(): boolean {
  try {
    return window.localStorage.getItem(CORRUPT_VERDICT_KEY) === '1';
  } catch {
    return false; // 프라이빗 모드 등에서 접근이 막힐 수 있다 — 없으면 없는 대로 동작한다
  }
}

export function rememberGpuCorruptedVerdict(): void {
  try {
    window.localStorage.setItem(CORRUPT_VERDICT_KEY, '1');
  } catch {
    // 저장 못 해도 동작에는 지장이 없다. 매번 다시 판정할 뿐이다.
  }
}

export function forgetGpuCorruptedVerdict(): void {
  try {
    window.localStorage.removeItem(CORRUPT_VERDICT_KEY);
  } catch {
    // 지우지 못해도 이번 세션 동작에는 영향이 없다.
  }
}

/**
 * `?delegate=` 로 시작 지점을 지정한다 — `cpu` · `gpu` · `gpu-canvas`.
 *
 * `gpu-canvas` 가 따로 있는 이유: 명시 캔버스 워크어라운드(mediapipe#4499)는 자동 경로에서
 * GPU 가 깨진 **다음** 단계인데, 한 번 CPU 판정이 저장되면 다음 로드부터 그 단계를 건너뛰어
 * 영영 시험되지 않는다. 사람이 직접 그 지점부터 시작할 수 있어야 한다.
 */
export function delegateStartFromUrl(): 'GPU' | 'CPU' | 'GPU_CANVAS' | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return null;
  const match = /[?&]delegate=(gpu-canvas|gpu|cpu)/i.exec(window.location.search);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'gpu-canvas') return 'GPU_CANVAS';
  return value === 'cpu' ? 'CPU' : 'GPU';
}

/**
 * 검출 신뢰도 임계값은 의도적으로 지정하지 않는다.
 *
 * min{Hand,Face}DetectionConfidence / min...PresenceConfidence / minTrackingConfidence 는
 * 라이브러리 기본값(각 0.5)을 그대로 쓴다. 이 프로젝트에 맞는 값은 실측 전까지 알 수 없고,
 * 여기에 임의의 숫자를 적으면 그게 검증된 튜닝값처럼 굳는다.
 * 실측으로 근거가 생기면 그때 이 파일에 추가한다.
 */

/**
 * `outputFaceBlendshapes` 는 켜지 않는다.
 *
 * 표정을 52개 스칼라로 요약해 주는 편리한 출력이지만, 그건 이미 전처리다. 프론트는 가공하지
 * 않은 랜드마크를 그대로 보내고 축약은 서버 전처리 모듈 한 곳에서만 한다(설계 결정 1).
 * 여기서 blendshape 을 뽑아 쓰기 시작하면 학습 코드와 다른 두 번째 전처리 경로가 생긴다.
 *
 * 방향도 반대다. T-04 는 얼굴을 스칼라로 압축하는 대신 **메쉬에서 지점을 골라 좌표 그대로**
 * 쓰기로 하고 있다(레퍼런스들이 수십 점 규모를 쓰고, 전체를 넣으면 오히려 나빠진다는 근거).
 * 그 지점 선택의 입력이 아래의 원본 메쉬다.
 * ※ T-04 페이지는 제목·로드맵(스칼라)과 배경·기대결과(좌표 부분집합)가 아직 서로 어긋나 있다.
 *   어느 쪽이든 프론트가 원본을 그대로 넘긴다는 이 판단은 바뀌지 않는다.
 *
 * 켜지 않으면 얼굴 추론 패스도 하나 줄어든다 — 아키텍처 근거와 성능 근거가 같은 쪽이다.
 */

/**
 * WASM 런타임과 모델 경로. `pnpm setup:mediapipe` 가 public/ 아래에 배치한다.
 *
 * CDN 을 쓰지 않는다 — 데모 현장 네트워크에 의존하게 된다. 같은 오리진에서만 읽는다.
 * Expo 웹은 public/ 을 사이트 루트로 서빙한다. (public/assets 는 Metro 예약 경로라 피한다.)
 */
export const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';
export const HAND_LANDMARKER_MODEL_PATH = '/mediapipe/models/hand_landmarker.task';
/**
 * ⚠️ 얼굴 메쉬 점 개수는 이 모델 파일이 결정한다 — tasks-vision 옵션에는 점 개수를 바꾸는
 * 항목이 없다(FaceLandmarkerOptions 에 legacy FaceMesh 의 refineLandmarks 에 해당하는
 * 옵션이 존재하지 않는다). 현재 고정된 face_landmarker/float16/1 은 홍채(468·473)를 포함한
 * **478점**을 출력하며, 새 모델(SPOTER-208)의 얼굴 서브셋 계약이 468·473 을 요구하므로
 * 478점 출력이 계약이다. 468점짜리 변형 모델로 교체하면 홍채가 없어 계약 위반이 된다 —
 * 모델 파일 URL(scripts/setup-mediapipe-assets.mjs)을 바꿀 때 반드시 점 개수를 확인할 것.
 */
export const FACE_LANDMARKER_MODEL_PATH = '/mediapipe/models/face_landmarker.task';
/** 포즈는 lite 모델이다 — 임시 선택. 근거와 교체 절차는 scripts/setup-mediapipe-assets.mjs 참고. */
export const POSE_LANDMARKER_MODEL_PATH = '/mediapipe/models/pose_landmarker_lite.task';

/**
 * 서버 전송용 landmarker 모델 버전 식별자 (CaptureMeta.landmarker_model_versions).
 *
 * setup-mediapipe-assets.mjs 의 다운로드 URL 경로(모델명/정밀도/버전)와 항상 함께 바꾼다.
 * 아카이브된 데이터가 어느 landmarker 로 뽑혔는지 추적하는 용도라, 파일명만으로는 버전
 * 디렉토리(.../1/)가 사라져서 부족하다.
 */
export const LANDMARKER_MODEL_VERSIONS: Record<string, string> = {
  hand: 'hand_landmarker/float16/1',
  face: 'face_landmarker/float16/1',
  pose: 'pose_landmarker_lite/float16/1',
};

/**
 * MediaPipe 라이브러리 본체(IIFE 빌드). 번들러가 아니라 런타임 <script> 로 읽는다.
 * 이유는 visionRuntime.web.ts 주석 참고 (Metro 가 라이브러리의 동적 import 를 거부한다).
 */
export const MEDIAPIPE_BUNDLE_PATH = '/mediapipe/vision_bundle.js';

/**
 * ⚠️ **더 이상 카메라를 여는 데 쓰지 않는다.** 지금은 `facing_mode` 캡처 메타의 출처일 뿐이다
 * (`capture/useSegmentRecorder.ts`).
 *
 * 원래는 이 조합으로 세로(9:16)를 요청했는데, **크기를 요청하는 순간 Chrome 이 가로로
 * 뒤집는다**는 것이 실측으로 드러났다 (2026-08-26, Galaxy — 표는 `CAMERA_PORTRAIT_SIZE` 주석).
 * 그래서 여는 경로는 `CAMERA_BASE_CONSTRAINTS`(크기 요청 없음)로 바뀌었다.
 *
 * 값을 남겨 두는 이유는 두 가지다 — `facingMode` 를 여기서 읽고 있고, "이 요청은 통하지
 * 않는다"는 사실 자체가 다시 시도되는 것을 막는 기록이기 때문이다.
 */
export const CAMERA_CONSTRAINTS_HINT = {
  width: { ideal: 720 },
  height: { ideal: 1280 },
  aspectRatio: { ideal: 9 / 16 },
  facingMode: 'user',
} as const;

/**
 * 크기를 요청하지 않는 최소 constraint — **세로를 받아 내는 정상 경로의 1단계**다.
 *
 * 크기를 안 물어보면 기기가 자기 기본값을 준다. 실측(2026-08-26, Galaxy / Chrome)에서
 * 그 기본값이 **480x640 = 세로 3:4** 였다. 반대로 크기를 요청하는 순간 Chrome 이 가로로
 * 뒤집어 버린다(아래 표).
 */
export const CAMERA_BASE_CONSTRAINTS = {
  facingMode: 'user',
} as const;

/**
 * 세로 9:16 — **기본값이 가로인 기기에서만** 재생 중인 트랙에 걸어 본다.
 *
 * ⚠️ 기본값이 이미 세로면 걸지 않는다. 거는 순간 가로로 뒤집히기 때문이다 —
 * `ensurePortraitFrames()` 주석 참고.
 *
 * ⚠️ 왜 이렇게 돌아가는가 — `getUserMedia` 의 시작 constraint 로는 세로를 못 받는다.
 * 같은 기기·같은 세션에서 후보를 전부 재 본 실측이다 (2026-08-26, Galaxy / Chrome.
 * 개발 화면 「세로 요청 실험」 버튼 = `cameraProbe.web.ts`):
 *
 *     요청                              실제 받은 것
 *     ideal 720x1280 + AR 9/16          (권한 경합으로 실패)
 *     exact 720x1280                    1280x720   ← 가로로 뒤집힘
 *     AR 만 exact 9/16                  480x270    ← 비율도 뒤집고 해상도까지 깎임
 *     min/max 로 720x1280 고정          1280x720   ← 가로로 뒤집힘
 *     ideal 1080x1920                   1920x1080  ← 가로로 뒤집힘
 *     크기 요청 없음                    480x640    ← **세로 3:4 (기기 기본값)**
 *     연 뒤 applyConstraints(720x1280)  720x1280   ← **세로 9:16, 원하는 것**
 *
 * 즉 세로가 불가능한 게 아니라 **시작 constraint 의 선택 알고리즘이 가로를 고른다.**
 * 트랙이 열린 뒤 바꾸는 경로는 그 알고리즘을 타지 않아서 그대로 통한다.
 *
 * ⚠️ **크롭으로 대신할 수 없다.** 1280x720 을 받아 9:16 으로 자르면 센서 기준 가로 화각이
 * 32% 만 남아(카메라앱 세로는 42%) 오히려 1.33배 더 확대되고, 해상도도 405x720 으로
 * 떨어진다. 세로 트랙을 받아 내는 것과 같은 결과가 아니다.
 */
export const CAMERA_PORTRAIT_SIZE = {
  width: { exact: 720 },
  height: { exact: 1280 },
} as const;

/**
 * 세로 요청 뒤 `<video>` 크기가 정착하기를 기다리는 상한(ms).
 *
 * `resize` 이벤트가 오면 즉시 끝나고, 안 오면(요청이 조용히 무시됐거나 이미 그 크기였으면)
 * 이 시간만큼만 기다리고 진행한다. **미확정 임시값이다** — 카메라 시작 지연에 그대로
 * 얹히므로, 실기기에서 첫 프레임이 늦다는 피드백이 오면 여기부터 본다.
 */
export const PORTRAIT_SETTLE_TIMEOUT_MS = 800;
