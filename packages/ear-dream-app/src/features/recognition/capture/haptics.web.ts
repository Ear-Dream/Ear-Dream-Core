/**
 * 캡처 시작 햅틱 피드백 — 웹 구현.
 *
 * 계약(신호는 시작 하나뿐이고 진동은 언제나 보조)과 그렇게 정한 근거는 haptics.ts 에 있다.
 * 여기는 그 하나의 신호를 브라우저에서 어떻게 내는지만 담는다.
 *
 * ## 경로가 둘이다
 *
 * 1. **Vibration API** (`navigator.vibrate`) — 안드로이드 크롬/파이어폭스. 길이를 ms 로 준다.
 * 2. **iOS 우회** — 아래 「iOS」 절. 세기도 길이도 제어할 수 없고 「탭 1회」만 낼 수 있다.
 *
 * 신호가 하나라 두 경로가 표현할 수 있는 것이 정확히 일치한다 — iOS 의 표현력이 계약의
 * 상한이었는데, 그 상한이 곧 필요한 전부가 됐다.
 *
 * ## iOS — `switch` 체크박스 토글 (⚠️ 우회이고 미검증이다)
 *
 * iOS Safari 에는 Vibration API 가 **없다**(구현 계획도 공개된 바 없다). 유일하게 알려진
 * 웹 경로는 Safari 17.4 가 추가한 `<input type="checkbox" switch>` 컨트롤이다 — 이 토글이
 * 넘어갈 때 시스템이 스위치 햅틱을 낸다. 화면 밖에 숨겨 둔 스위치를 코드로 토글해서 그
 * 햅틱만 빌린다.
 *
 * 이 경로의 성격을 분명히 해 둔다:
 *
 * - **애플이 보장하는 API 가 아니다.** 스위치 컨트롤의 부수 효과이고, 언제든 사라질 수 있다.
 * - **이 레포에 iOS 실기기 검증 수단이 없다** — 다른 iOS 워크어라운드들과 같은 상태다
 *   (useLandmarker.web.ts 의 WKWebView 워크어라운드 주석 참고). 실기기에서 확인하기 전까지
 *   "아이폰에서 진동이 온다"고 문서·발표에 쓰지 말 것.
 * - **안 되면 조용히 아무 일도 일어나지 않는다.** 계약(진동은 보조)이 그것을 감당한다.
 * - **세기도 길이도 못 올린다.** 안드로이드는 `PULSE_MS` 로 체감 세기를 키울 수 있지만, 이
 *   경로는 시스템이 정한 스위치 햅틱 그대로다 — "더 강하게" 요구가 iOS 에는 닿지 않는다.
 *
 * 숨기는 방식에 제약이 있다: `display:none` / `visibility:hidden` 은 컨트롤이 아예 렌더되지
 * 않아 토글 애니메이션도 햅틱도 나지 않는다. 그래서 레이아웃에는 남기고 1px · opacity 0 로
 * 밀어 둔다.
 */

import type { HapticDiagnostics } from './haptics';

/**
 * 진동 길이(ms). **미확정 임시값 — 실기기 체감으로 조정 중이다.**
 *
 * ⚠️ **세기는 이 상수로 조절하는 것이 아니라, 조절할 수단이 아예 없다.** Vibration API 는
 * 진폭·세기 파라미터가 없고 길이(ms)만 받는다. 다만 다수 기기의 진동 모터가 짧은 펄스에서는
 * 최대 진폭에 도달하기 전에 멈추기 때문에, **길게 주면 실제로 더 세게 느껴진다** — "더 강하게"
 * 라는 요구에 대응할 수 있는 유일한 노브가 길이인 이유다.
 *
 * 값의 내력(전부 사용자 체감 피드백으로 올렸고, 실기기 계측은 아직 없다):
 *   45 → 90 → **200** (2026-08-25). 45 도 90 도 약하다는 피드백이 이어져 "확실히 다르게
 *   느껴지는" 영역까지 올렸다. 200ms 는 짧은 진동을 고정 길이 틱으로 뭉개는 기기(진폭 제어가
 *   없는 LRA 액추에이터 계열)에서도 구분되는 길이다.
 *
 * 신호가 하나가 되면서 **여기를 더 올릴 여유가 생겼다** — 예전에는 종료 2회의 총 길이
 * (520ms)가 상한을 눌렀지만 이제 점유 구간이 이 값 그대로다. 다만 누르고 있는 시간보다
 * 길어지면 뗀 뒤까지 울리므로, 올리더라도 한 단어를 누르는 시간 안에 끝나야 한다.
 * 200ms 로도 체감이 그대로라면 원인은 길이가 아니다(아이폰이거나, 새 번들이 폰에
 * 반영되지 않았거나 — 개발 화면의 햅틱 진단이 그 둘을 가른다).
 */
const PULSE_MS = 200;

/** 마지막 `navigator.vibrate()` 반환값 (진단 전용 — 계약·근거는 haptics.ts). */
let lastVibrateResult: boolean | null = null;

/** 재생 중인 신호가 끝나는 시각(ms). 겹침이 돌아오면 알아채기 위한 것이다. */
let busyUntilMs = 0;

/** 신호 집계 (진단 전용). `replaced` 는 항상 0 이어야 한다 — 회귀 감지용. */
const counters = { emitted: 0, replaced: 0 };

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** 기록 시작 — 진동 1회. 이 모듈의 유일한 신호다. */
export function captureStartFeedback(): void {
  if (canVibrate()) {
    // 신호가 하나라 여기 걸릴 일이 없어야 한다. 걸리면 겹침이 돌아온 것이다(haptics.ts).
    if (busyUntilMs > nowMs()) counters.replaced += 1;
    // ⚠️ 한때 여기서 `navigator.vibrate(0)` 로 먼저 끄고 넣었다. 신호가 여럿이던 시절
    // "모터가 도는 중 들어온 요청을 무시하는 기기가 있다"는 보고에 대응한 것이었는데,
    // **신호가 하나가 된 지금은 끌 대상 자체가 없다.** 근거가 사라진 반면 위험은 남는다 —
    // 취소가 뒤늦게 처리되면 방금 넣은 패턴까지 지운다. 그래서 걷어냈다.
    // 다시 넣고 싶다면 겹침이 돌아왔는지(`replaced`)부터 확인할 것.
    lastVibrateResult = navigator.vibrate(PULSE_MS);
    counters.emitted += 1;
    busyUntilMs = nowMs() + PULSE_MS;
    return;
  }
  playSwitchTap();
}

/**
 * 실기기 진단 스냅샷. 계약·근거는 haptics.ts 의 `HapticDiagnostics` 주석에 있다.
 * 개발 화면(`?dev=1`)의 햅틱 패널만 쓴다 — 제품 흐름은 이 함수를 부르지 않는다.
 */
export function readHapticDiagnostics(): HapticDiagnostics {
  const vibrateAvailable = canVibrate();
  const switchSupported = supportsSwitchControl();
  return {
    path: vibrateAvailable ? 'vibration' : switchSupported ? 'ios-switch' : 'none',
    vibrateAvailable,
    switchSupported,
    lastVibrateResult,
    documentVisible: typeof document === 'undefined' || document.visibilityState === 'visible',
    pulseMs: PULSE_MS,
    counters: { ...counters },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
}

// --- iOS 우회 ---------------------------------------------------------------

/** 숨긴 스위치를 감싼 label. 토글은 label 클릭으로 일으킨다(발견된 우회의 형태 그대로). */
let switchLabel: HTMLLabelElement | null = null;

/**
 * `switch` 속성 지원 여부. Safari 17.4+ 는 HTMLInputElement 에 `switch` IDL 속성을 만든다.
 * 지원하지 않는 브라우저에서는 우회 자체를 시도하지 않는다(빈 요소를 DOM 에 남기지 않는다).
 */
function supportsSwitchControl(): boolean {
  if (typeof document === 'undefined') return false;
  return 'switch' in document.createElement('input');
}

function getSwitchLabel(): HTMLLabelElement | null {
  if (switchLabel?.isConnected) return switchLabel;
  if (!supportsSwitchControl() || !document.body) return null;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;

  const label = document.createElement('label');
  // 보조기술에는 존재하지 않는 요소다 — 화면에 의미가 없고 조작 대상도 아니다.
  label.setAttribute('aria-hidden', 'true');
  // display:none 이면 렌더되지 않아 햅틱도 나지 않는다(파일 상단 주석) — 밀어서 숨긴다.
  Object.assign(label.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    opacity: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  label.appendChild(input);
  document.body.appendChild(label);

  switchLabel = label;
  return label;
}

function playSwitchTap(): void {
  const label = getSwitchLabel();
  if (!label) return;
  label.click();
}
