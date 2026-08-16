/**
 * 개발용 진입점 노출 플래그.
 *
 * 여긴 기능 스위치가 아니라 **측정 도구에 들어가는 문**이다. 제품 동작을 바꾸지 않는다.
 */

/**
 * 랜드마크 확인 화면(FPS · 단계별 처리 시간 · 실제 delegate HUD) 노출 여부.
 *
 * 왜 `__DEV__` 만으로는 부족한가 — 실기기 모바일 웹은 `pnpm build:web-mobile`(= `expo export`)
 * 로 만든 **프로덕션 번들**이라 `__DEV__` 가 false 다. 그래서 지금까지 실기기에서는 FPS 를 읽을
 * 화면 자체에 들어갈 수 없었다. 그런데 폰에서 3모델(손·얼굴·포즈)이 몇 fps 로 도는지는
 * 아직 아무도 측정한 적이 없고(CLAUDE.md 「사람이 직접 해야 하는 실측 항목」),
 * FACE_DETECT_EVERY_N_FRAMES 를 **측정 없이 바꾸는 것은 금지**다. 측정할 수 없으면 그 값은
 * 영원히 미측정 기본값(1)으로 남는다 — 그래서 프로덕션 웹 빌드에도 문을 하나 남긴다.
 *
 *   EXPO_PUBLIC_LANDMARK_DEV=1 pnpm build:web-mobile   빌드에 상시 노출
 *   https://<주소>/?dev=1                              이미 만든 빌드를 URL 로 열기 (웹 전용)
 *
 * 제품 화면에는 아무 변화가 없다. 홈 화면의 "개발용" 항목이 보이느냐만 달라진다.
 */
function urlFlagEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return false;
  return /[?&]dev=1(?:&|$)/.test(window.location.search) || window.location.hash === '#dev';
}

export const LANDMARK_DEV_ENABLED: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_LANDMARK_DEV === '1' || urlFlagEnabled();
