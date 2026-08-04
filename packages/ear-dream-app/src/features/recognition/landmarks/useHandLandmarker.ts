/**
 * 손 랜드마크 추출 훅 — 네이티브(기본) 구현.
 *
 * `@mediapipe/tasks-vision` 은 브라우저 WASM 기반이라 웹에서만 동작한다.
 * Expo Go 를 포함한 네이티브에서는 실행할 수 없으므로 여기서는 'unsupported' 만 돌려준다.
 * 이건 T-03 단계에서 알려진 정상 상태다. 검증은 `pnpm dev:web` 으로 한다.
 *
 * 번들러는 웹에서 useHandLandmarker.web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 *
 * 나중에 네이티브를 지원할 때 바꿀 곳은 이 파일 하나다.
 * development build 로 전환(`npx expo prebuild`)한 뒤, 네이티브 MediaPipe 든 서버 추론이든
 * types.ts 의 UseHandLandmarkerResult 만 맞춰 구현하면 화면 코드는 그대로 쓴다.
 */
import type { UseHandLandmarkerOptions, UseHandLandmarkerResult } from './types';

export function useHandLandmarker(_options: UseHandLandmarkerOptions = {}): UseHandLandmarkerResult {
  return {
    status: 'unsupported',
    error: '손 랜드마크 추출은 현재 웹에서만 동작합니다. `pnpm dev:web` 으로 확인하세요.',
    hands: [],
    fps: 0,
    sourceWidth: 0,
    sourceHeight: 0,
  };
}
