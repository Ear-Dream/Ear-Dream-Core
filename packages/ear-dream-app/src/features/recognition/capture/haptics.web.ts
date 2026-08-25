/**
 * 캡처 시작/종료 햅틱 피드백 — 웹 구현.
 *
 * 계약(시작 1회 / 종료 2회, 진동은 언제나 보조)은 haptics.ts 에 있다. 여기는 그 계약을
 * 브라우저에서 어떻게 내는지만 담는다.
 *
 * ## 경로가 둘이다
 *
 * 1. **Vibration API** (`navigator.vibrate`) — 안드로이드 크롬/파이어폭스. 길이를 ms 로
 *    직접 지정한다. 여기서만 `[진동, 쉼, 진동]` 패턴이 가능하다.
 * 2. **iOS 우회** — 아래 「iOS」 절. 세기도 길이도 제어할 수 없고 「탭 1회」만 낼 수 있다.
 *
 * 그래서 계약이 길이가 아니라 **횟수** 기준이다 — 두 경로가 표현할 수 있는 교집합이 그것뿐이다.
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
 * - **안 되면 조용히 아무 일도 일어나지 않는다.** 계약 2(진동은 보조)가 그것을 감당한다.
 * - **세기를 못 올린다.** 안드로이드는 `PULSE_MS` 를 늘려 체감 세기를 키울 수 있지만, 이
 *   경로는 시스템이 정한 스위치 햅틱 그대로다 — "더 강하게" 요구가 iOS 에는 닿지 않는다.
 *
 * 숨기는 방식에 제약이 있다: `display:none` / `visibility:hidden` 은 컨트롤이 아예 렌더되지
 * 않아 토글 애니메이션도 햅틱도 나지 않는다. 그래서 레이아웃에는 남기고 1px · opacity 0 로
 * 밀어 둔다.
 */

/**
 * 진동 1회 길이(ms). **미확정 임시값 — 실기기 체감으로 조정 중이다.**
 *
 * ⚠️ **세기는 이 상수로 조절하는 것이 아니라, 조절할 수단이 아예 없다.** Vibration API 는
 * 진폭·세기 파라미터가 없고 길이(ms)만 받는다. 다만 다수 기기의 진동 모터가 짧은 펄스에서는
 * 최대 진폭에 도달하기 전에 멈추기 때문에, **길게 주면 실제로 더 세게 느껴진다** — "더 강하게"
 * 라는 요구에 대응할 수 있는 유일한 노브가 길이인 이유다.
 *
 * 값의 내력(전부 사용자 체감 피드백으로 올렸고, 실기기 계측은 아직 없다):
 *   45 → 90 → **200** (2026-08-25). 45 도 90 도 약하다는 피드백이 이어져 "확실히 다르게
 *   느껴지는" 영역까지 한 번에 올렸다. 200ms 는 짧은 진동을 고정 길이 틱으로 뭉개는 기기
 *   (진폭 제어가 없는 LRA 액추에이터 계열)에서도 구분되는 길이다.
 *
 * ⚠️ **여기서 더 올리는 것은 곧 한계에 부딪힌다.** 종료(2회)의 총 길이가
 * `2×PULSE + GAP` 이라 지금도 520ms 다. 더 키우면 손가락을 뗀 뒤에도 한참 울려서
 * "언제 끝났는지"가 도로 흐려진다 — 이 기능이 풀려던 문제로 되돌아간다.
 * 200ms 로도 체감이 그대로라면 원인은 길이가 아니다(아이폰이거나, 새 번들이 폰에
 * 반영되지 않았거나).
 */
const PULSE_MS = 200;

/**
 * 종료 진동 두 번 사이의 쉼(ms). **미확정 임시값.**
 *
 * 너무 짧으면 두 번이 하나의 긴 진동으로 뭉쳐 들려 「시작(1회)」과 구분이 사라진다 —
 * 이 값이 계약을 지탱하는 지점이다. **`PULSE_MS` 를 올리면 이 값도 같이 봐야 한다**:
 * 긴 펄스일수록 모터의 잔여 진동이 쉼을 메워 뭉치기 쉽다. 펄스를 200ms 로 올리면서
 * 쉼도 120ms 로 함께 올렸다. 실기기에서 종료가 "길게 한 번"으로 들리면 여기부터 늘릴 것.
 */
const GAP_MS = 120;

/**
 * 단어 확정 진동 길이(ms). **미확정 임시값.**
 *
 * 시작(`PULSE_MS`)과 같은 1회지만 눈에 띄게 가볍게 둬서, 손가락을 누르지 않았는데 온
 * 진동임을 체감으로도 구분되게 한다. 시작을 올릴 때 함께 올리되 **비율은 유지하지 않는다** —
 * 시작의 절반(100ms)이면 "가벼운 알림"이 아니라 그냥 또 하나의 강한 진동이 된다. 단어마다
 * 울리는 신호라 방해가 되지 않는 선이 우선이고, 시작과 확실히 다르기만 하면 된다.
 * 이 신호는 pill 전환이라는 시각 피드백이 항상 병행되므로 놓쳐도 손실이 없다.
 */
const CONFIRM_PULSE_MS = 80;

/**
 * iOS 우회에서 탭 두 번 사이의 간격(ms). **미확정 임시값.**
 *
 * 스위치 토글 애니메이션이 끝나기 전에 다시 토글하면 두 번째 햅틱이 나지 않을 수 있어
 * Vibration 경로의 쉼(90ms)보다 넉넉히 잡았다.
 */
const SWITCH_TAP_GAP_MS = 130;

/**
 * 앞 신호가 끝난 뒤 다음 신호를 붙일 때 두는 여유(ms). **미확정 임시값.**
 *
 * 0 이면 두 신호가 맞붙어 하나로 읽힌다 — 「1회/2회」 계약이 무너지는 지점이라 최소한의
 * 간격을 둔다. 종료의 쉼(`GAP_MS`)보다 짧게 잡아야 "한 신호 안의 쉼"과 "다른 신호"가
 * 뒤바뀌어 들리지 않는다.
 */
const SETTLE_MS = 60;

// --- 겹침 방지 -------------------------------------------------------------
//
// ⚠️ **Vibration API 는 새 호출이 재생 중인 진동을 취소하고 대체한다**(스펙). 이 서비스는
// 진동을 내는 지점이 둘이고 그 둘이 서로 다른 시계로 돈다:
//
//   · 캡처 시작/종료 — 사용자의 손가락 (누르는 순간)
//   · 단어 확정      — 서버 응답 (언제 올지 모른다)
//
// 그래서 "떼고 곧바로 다음 단어를 누르는" 빠른 입력에서 앞 단어의 응답이 시작 진동
// 한가운데로 떨어진다. 취소·대체가 일어나 **시작 진동이 잘려 사라진 것처럼 느껴진다**
// (실사용 보고: "가끔 진동이 안 온다"). 신호가 길수록 겹칠 창이 넓어져 더 자주 걸린다 —
// PULSE_MS 를 45 에서 90 으로 올렸을 때 이 증상이 드러난 이유다.
//
// 규칙:
//   1. **캡처 신호는 절대 미루지 않는다.** 손가락과 동시여야 의미가 있다. 재생 중인 것이
//      있으면 대체한다 — 사용자가 방금 새 동작을 시작했으니 앞 신호는 이미 지난 정보다.
//   2. **확정 신호는 미룬다.** 어차피 비동기로 도착한 신호라 수십 ms 늦어도 의미가 같고,
//      pill 전환이라는 시각 피드백이 병행된다. 재생 중인 것을 잘라 먹는 쪽이 훨씬 나쁘다.
//   3. 미뤄 둔 확정 신호는 **캡처 신호가 오면 버린다.** 사용자가 이미 다음 동작에 들어갔는데
//      뒤늦게 울리면 그 동작의 신호로 오해된다.

/** 재생 중인 신호가 끝나는 시각(ms). */
let busyUntilMs = 0;
/** 미뤄 둔 확정 신호의 타이머들 (확정이 연달아 오면 줄을 선다). */
let deferredTimers: ReturnType<typeof setTimeout>[] = [];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function cancelDeferred(): void {
  for (const timer of deferredTimers) clearTimeout(timer);
  deferredTimers = [];
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** 패턴 총 길이(ms) — 점유 구간 계산용. */
function cueDurationMs(count: number, pulseMs: number): number {
  return count * pulseMs + (count - 1) * GAP_MS;
}

/**
 * 신호 하나를 지금 즉시 내보내고 점유 구간을 기록한다.
 * Vibration API 가 없으면 iOS 우회로 내려가고, 둘 다 없으면 아무 일도 하지 않는다(계약 2).
 */
function emit(count: number, pulseMs: number): void {
  if (canVibrate()) {
    const pattern: number[] = [];
    for (let i = 0; i < count; i += 1) {
      if (i > 0) pattern.push(GAP_MS);
      pattern.push(pulseMs);
    }
    navigator.vibrate(pattern);
    busyUntilMs = nowMs() + cueDurationMs(count, pulseMs);
    return;
  }
  emitSwitchTaps(count);
}

/** 규칙 1·3 — 캡처 신호. 즉시 내보내고 미뤄 둔 확정 신호는 버린다. */
function playCaptureCue(count: number, pulseMs: number): void {
  cancelDeferred();
  emit(count, pulseMs);
}

/** 규칙 2 — 확정 신호. 재생 중이면 그것이 끝난 뒤로 미룬다. */
function playDeferrableCue(count: number, pulseMs: number): void {
  const wait = busyUntilMs - nowMs();
  if (wait <= 0) {
    emit(count, pulseMs);
    return;
  }
  // 점유 구간을 지금 늘려 둔다 — 확정이 연달아 와도 서로를 자르지 않고 줄을 선다.
  const startAt = wait + SETTLE_MS;
  busyUntilMs += SETTLE_MS + cueDurationMs(count, pulseMs);
  const timer = setTimeout(() => {
    deferredTimers = deferredTimers.filter((pending) => pending !== timer);
    emit(count, pulseMs);
  }, startAt);
  deferredTimers.push(timer);
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

function emitSwitchTaps(count: number): void {
  const label = getSwitchLabel();
  if (!label) return;
  for (let i = 0; i < count; i += 1) {
    if (i === 0) {
      label.click();
    } else {
      // 토글 애니메이션이 끝난 뒤 두 번째 탭. 실패해도 첫 탭은 이미 나갔다.
      setTimeout(() => label.click(), SWITCH_TAP_GAP_MS * i);
    }
  }
  // 탭 자체는 순간이지만 「1회/2회」로 읽히려면 앞뒤 간격이 필요하다 — Vibration 경로와
  // 같은 겹침 규칙을 태우기 위해 점유 구간을 잡아 둔다.
  busyUntilMs = nowMs() + count * SWITCH_TAP_GAP_MS;
}

// --- 계약 구현 (haptics.ts 와 시그니처 동일) ---------------------------------

/** 기록 시작 — 진동 1회. 손가락과 동시여야 하므로 절대 미루지 않는다. */
export function captureStartFeedback(): void {
  playCaptureCue(1, PULSE_MS);
}

/** 기록 종료 — 진동 2회 (시작과 횟수로 구분). 시작과 같은 이유로 미루지 않는다. */
export function captureStopFeedback(): void {
  playCaptureCue(2, PULSE_MS);
}

/** 단어 자동 확정 — 진동 1회, 가장 짧게. 재생 중인 신호가 있으면 미룬다(「겹침 방지」). */
export function recognizeConfirmFeedback(): void {
  playDeferrableCue(1, CONFIRM_PULSE_MS);
}
