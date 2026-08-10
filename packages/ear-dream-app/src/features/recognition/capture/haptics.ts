/**
 * 캡처 버튼 시작/종료 햅틱 피드백.
 *
 * ⚠️ `expo-haptics` 가 의존성에 없다 (새 의존성 추가 금지 방침). 네이티브(iOS/Android)에서
 * 진짜 햅틱이 필요해지면 팀 결정 후 `npx expo install expo-haptics` 로 설치하고 이 파일만
 * 교체하면 된다. 그때까지는:
 *   - 웹: `navigator.vibrate` (지원 브라우저에서만 — iOS Safari 는 미지원)
 *   - 그 외: 아무것도 하지 않음. 시각 피드백(버튼 상태 변화)이 항상 병행되므로
 *     소리·진동 없이도 상태를 알 수 있다 — 청각 장애 사용자 접근성 원칙과도 일치한다.
 */

function vibrate(pattern: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

/** 기록 시작 피드백 — 짧은 진동 1회. */
export function captureStartFeedback(): void {
  vibrate(20);
}

/** 기록 종료 피드백 — 더 짧은 진동 1회 (시작과 구분). */
export function captureStopFeedback(): void {
  vibrate(10);
}

/**
 * 단어 자동 확정 피드백 — pill 이 대기(…)에서 단어로 바뀌는 순간.
 * 사용자는 이미 다음 단어를 동작 중일 수 있어 화면을 못 볼 수 있다 — 진동으로 보조한다.
 * (시각 피드백(pill 전환)이 항상 병행된다. 패턴 30ms 는 임시값 — 시작/종료와 구분되면 된다.)
 */
export function recognizeConfirmFeedback(): void {
  vibrate(30);
}
