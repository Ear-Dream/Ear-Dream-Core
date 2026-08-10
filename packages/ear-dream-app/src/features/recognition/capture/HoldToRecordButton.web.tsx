/**
 * 누르는-동안 기록 버튼 — 웹 구현 (pointer capture).
 *
 * ## 계약 (녹화 종료 트리거) — HoldToRecordButton.tsx 와 동일
 *
 * **활성 녹화(hold)의 종료 트리거는 "사용자가 손가락을 뗌" 단 하나다.**
 * 검출 상태 변화, 리렌더, pill/배너 등장·소멸, disabled 전환, 제스처 경합 —
 * 그 무엇도 진행 중인 hold 를 끝내면 안 된다. 브라우저가 포인터를 강제로 취소하면
 * (pointercancel / lostpointercapture) 뗌과 동일하게 onHoldEnd 를 호출한다 —
 * 그때까지 모인 프레임은 사용자의 실제 동작이므로 소비 측이 정상 마감·제출한다.
 *
 * ## 왜 RNW Pressable 을 쓰지 않는가 (실측 근거)
 *
 * RNW(0.21.2)의 책임(responder) 시스템은 press 유지 중 다음 이벤트로 책임을 종단시키고,
 * 종단은 onPressOut 발화 = 조기 녹화 종료가 된다. 브라우저 이벤트 주입으로 재현 확인
 * (2026-08, 손가락을 떼지 않았는데 녹화가 끝나고 세그먼트가 전송됨):
 *
 * - `contextmenu` — 모바일 브라우저는 롱프레스에 contextmenu 를 발화한다. 수어 한 단어의
 *   hold 는 항상 롱프레스보다 길어서 실기기에서 상시 재현 조건이다. Pressable 은
 *   onLongPress 가 없으면 이를 preventDefault 하지 않는다.
 * - `selectionchange` — 텍스트 노드 앵커의 유효 선택이 생기거나 변하면 종단된다. 안내
 *   pill 문구가 엄지 바로 옆에 있고, **손이 프레임에서 사라지는 순간 문구가 바뀌므로**
 *   기존 선택 위의 DOM 텍스트 교체 → selectionchange → 종단. 사용자가 보고한
 *   "손이 안 보일 때 멋대로 종료"의 경로다.
 * - 조상 scroll / window blur / touchcancel 도 같은 종단 경로다(코드 확인).
 *
 * 이 구현은 책임 시스템을 아예 거치지 않는다: 원시 DOM 요소 + Pointer Events +
 * `setPointerCapture`. 캡처된 포인터의 up/cancel 은 다른 DOM 이 어떻게 바뀌든 이
 * 요소로 온다. `touch-action: none` 이 스크롤 제스처 경합을, `user-select: none` +
 * `contextmenu` preventDefault 가 선택·컨텍스트 메뉴를 원천 차단한다.
 *
 * 시각 요소는 RN View(children)를 그대로 받아 그린다 — 입력 처리만 이 파일 소관이다.
 */
import { useCallback, useRef } from 'react';
import { View } from 'react-native';

import type { HoldToRecordButtonProps } from './HoldToRecordButton';

export type { HoldToRecordButtonProps };

export function HoldToRecordButton({
  disabled,
  onHoldStart,
  onHoldEnd,
  accessibilityLabel,
  style,
  children,
  testID,
}: HoldToRecordButtonProps) {
  // hold 당 start/end 를 정확히 1회로 짝짓는 가드 (pointerup 뒤 lostpointercapture 가
  // 한 번 더 오는 정상 시퀀스에서 onHoldEnd 가 중복 호출되지 않게). ref 인 이유는
  // 네이티브 구현과 같다 — 이 값이 리렌더를 만들면 안 된다.
  const holdingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  const endHold = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    pointerIdRef.current = null;
    onHoldEnd();
  }, [onHoldEnd]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // disabled 는 새 hold 의 시작만 막는다. 진행 중인 hold 는 어떤 경로로도 중단하지 않는다.
      if (disabled || holdingRef.current) return;
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

      // 캡처 실패(이미 해제된 포인터 등)해도 hold 는 시작한다 — 캡처는 보강이지 전제가 아니다.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // no-op
      }
      // 브라우저 기본 동작(텍스트 선택 시작, 호환 mouse 이벤트) 억제.
      event.preventDefault();
      pointerIdRef.current = event.pointerId;
      holdingRef.current = true;
      onHoldStart();
    },
    [disabled, onHoldStart],
  );

  const handlePointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== event.pointerId) return;
      // pointerup = 뗌, pointercancel / lostpointercapture = 시스템 취소.
      // 계약대로 동일하게 마감한다 — 프레임은 이미 기록돼 있고 소비 측이 제출한다.
      endHold();
    },
    [endHold],
  );

  // 키보드 접근성: Space/Enter 를 누르는 동안 = hold. (Pressable 대체로 잃는 기능 보전)
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || holdingRef.current) return;
      if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Spacebar') return;
      event.preventDefault();
      holdingRef.current = true;
      onHoldStart();
    },
    [disabled, onHoldStart],
  );

  const handleKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Spacebar') return;
      endHold();
    },
    [endHold],
  );

  return (
    <div
      role="button"
      aria-label={accessibilityLabel}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      data-testid={testID}
      style={rootStyle}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      // 키보드 hold 중 포커스를 잃으면(탭 전환 등) 취소로 간주해 마감한다.
      onBlur={endHold}
      // 롱프레스 컨텍스트 메뉴 차단 — hold 는 항상 롱프레스보다 길다.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* 시각 요소는 호출 측 RN 스타일 그대로. 입력은 위 div 가 전부 처리한다. */}
      <View style={style} pointerEvents="none">
        {children}
      </View>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  // 스크롤·줌 제스처가 이 버튼의 포인터를 가로채(pointercancel) 못하게 한다.
  touchAction: 'none',
  // 롱프레스 hold 중 텍스트 선택·iOS 콜아웃이 생기지 않게 한다.
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  cursor: 'pointer',
} as React.CSSProperties;
