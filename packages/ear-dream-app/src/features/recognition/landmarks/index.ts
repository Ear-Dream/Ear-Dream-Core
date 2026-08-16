/**
 * 손 · 얼굴 · 포즈 랜드마크 추출 (T-03).
 *
 * 화면은 이 배럴의 `CameraLandmarkView` 와 타입 계약만 보면 된다.
 * 플랫폼별 구현(.web / 네이티브)은 번들러가 고른다.
 *
 * ⚠️ `useLandmarker` 는 여기서 내보내지 않는다. 웹 구현(`useLandmarker.web.ts`)이
 * 중립 계약 `UseLandmarkerResult` 에 없는 `videoRef` 를 반환하므로, 프리뷰가 필요한
 * 소비자는 `./useLandmarker.web` 을 직접 import 한다. 네이티브를 붙일 때는 훅을 쓰기
 * 전에 **계약 확장이 선행돼야 한다** — 중립 스텁만 먼저 되살리면 프리뷰를 표현할
 * 방법이 없어 같은 우회가 반복된다.
 *
 * 매 프레임 데이터가 필요하면 onFrame 을 쓴다(리렌더 없음).
 * hands / face / fps 는 사람이 읽기 좋게 저빈도로만 갱신된다.
 */
export { CameraLandmarkView } from './CameraLandmarkView';
export type {
  DetectedFace,
  DetectedHand,
  DetectedPose,
  FaceFrame,
  LandmarkerDelegate,
  LandmarkerStatus,
  LandmarkPoint,
  LandmarkSnapshot,
  LandmarkTimings,
  UseLandmarkerOptions,
  UseLandmarkerResult,
} from './types';
export {
  GRIP_HAND_LABEL,
  HANDEDNESS_VERIFIED,
  PREVIEW_MIRRORED,
  SIGNING_HAND_LABEL,
} from './handedness';
export type { MediaPipeHandednessLabel } from './handedness';
