/**
 * 누르는-동안 기록 버튼 — 네이티브(기본) 구현.
 *
 * ## 계약 (녹화 종료 트리거)
 *
 * **활성 녹화(hold)의 종료 트리거는 "사용자가 손가락을 뗌" 단 하나다.**
 * 검출 상태 변화, 리렌더, pill/배너 등장·소멸, disabled 전환, 제스처 경합 —
 * 그 무엇도 진행 중인 hold 를 끝내면 안 된다. 시스템이 press 를 강제로 취소하는
 * 경우(책임 종단·포인터 취소)까지 막을 수 없는 플랫폼에서는, 취소를 "뗌"과 동일하게
 * 취급해 onHoldEnd 를 호출한다 — 그때까지 모인 프레임은 사용자의 실제 동작이므로
 * 버리지 않고 정상 마감·제출되어야 한다(소비 측 책임).
 *
 * - onHoldStart / onHoldEnd 는 hold 하나당 정확히 한 번씩 짝지어 호출된다.
 * - `disabled` 는 **새 hold 의 시작만** 막는다. 진행 중인 hold 는 절대 중단하지 않는다.
 *   (호출 측도 녹화 중에는 disabled 값을 동결할 것 — SignInputScreen 참고.)
 *
 * 웹에서는 RNW Pressable 의 책임(responder) 시스템이 contextmenu / selectionchange /
 * 조상 scroll / window blur 로 press 를 종단시켜 onPressOut 이 손가락과 무관하게
 * 발화한다(실측: 2026-08 브라우저 재현). 그래서 웹은 HoldToRecordButton.web.tsx 가
 * pointer capture 로 대체한다. 네이티브는 그 문제가 없어 Pressable 을 유지한다.
 */
import { useCallback, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';

export interface HoldToRecordButtonProps {
  /** 새 hold 시작 차단 여부. 진행 중인 hold 에는 영향을 주지 않는다. */
  disabled: boolean;
  onHoldStart: () => void;
  /** 뗌·시스템 취소 공통 종료 지점. hold 하나당 정확히 한 번 호출된다. */
  onHoldEnd: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
}

export function HoldToRecordButton({
  disabled,
  onHoldStart,
  onHoldEnd,
  accessibilityLabel,
  style,
  children,
  testID,
}: HoldToRecordButtonProps) {
  // start/end 를 hold 당 1회로 짝짓는 가드. 상태가 아니라 ref 다 — 이 값의 변화가
  // 리렌더를 일으켜 press 를 흔들면 그 자체가 이 컴포넌트가 막으려는 문제가 된다.
  const holdingRef = useRef(false);

  const handlePressIn = useCallback(() => {
    if (holdingRef.current || disabled) return;
    holdingRef.current = true;
    onHoldStart();
  }, [disabled, onHoldStart]);

  // RN 에서도 onPressOut 은 뗌뿐 아니라 책임 종단(취소)으로도 올 수 있다.
  // 계약대로 둘을 구분하지 않고 같은 종료로 다룬다 — 모인 프레임은 소비 측이 제출한다.
  const handlePressOut = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    onHoldEnd();
  }, [onHoldEnd]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={style}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}
