/**
 * 손 랜드마크 추출 설정값.
 *
 * 여기 있는 값 중 제품 사양으로 확정된 것은 하나도 없다. 목표 FPS, 허용 지연, 신뢰도 임계값,
 * 시간창 프레임 수는 실측과 사용자 검증 전까지 정해지지 않았다. 그럴듯한 숫자를 코드에 박아
 * 확정된 것처럼 보이게 하지 않기 위해, 필요한 값만 상수로 두고 근거를 함께 남긴다.
 */

/** MVP 제약상 손은 최대 2개. T-03 은 양손 모두 검출하고 선택은 하지 않는다(T-04). */
export const MAX_HANDS = 2;

/** FPS 이동평균 표본 수. 작업 지시서에 명시된 값(최근 30프레임)이라 임의값이 아니다. */
export const FPS_SAMPLE_WINDOW = 30;

/**
 * HUD(FPS, handedness 라벨) 리렌더 주기.
 * 제품 사양이 아니라 화면 표시 갱신 주기다. 숫자가 너무 빨리 바뀌면 육안으로 읽을 수 없고,
 * 매 프레임 리렌더하면 측정하려는 FPS 자체가 리렌더 비용에 오염된다.
 */
export const HUD_UPDATE_INTERVAL_MS = 250;

/**
 * 검출 신뢰도 임계값은 의도적으로 지정하지 않는다.
 *
 * minHandDetectionConfidence / minHandPresenceConfidence / minTrackingConfidence 는
 * 라이브러리 기본값(각 0.5)을 그대로 쓴다. 이 프로젝트에 맞는 값은 실측 전까지 알 수 없고,
 * 여기에 임의의 숫자를 적으면 그게 검증된 튜닝값처럼 굳는다.
 * 실측으로 근거가 생기면 그때 이 파일에 추가한다.
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
 * MediaPipe 라이브러리 본체(IIFE 빌드). 번들러가 아니라 런타임 <script> 로 읽는다.
 * 이유는 visionRuntime.web.ts 주석 참고 (Metro 가 라이브러리의 동적 import 를 거부한다).
 */
export const MEDIAPIPE_BUNDLE_PATH = '/mediapipe/vision_bundle.js';

/**
 * 카메라 요청 해상도. 브라우저가 정확히 이 값을 준다는 보장은 없고 ideal 힌트일 뿐이다.
 * 실제 해상도는 video.videoWidth/Height 로 읽어서 쓴다.
 * 해상도와 FPS 의 교환비는 실측 항목이라 아직 확정하지 않았다.
 */
export const CAMERA_CONSTRAINTS_HINT = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: 'user',
} as const;
