import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';

import { radius } from '../constants/theme';

export interface CircleIconButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  /** 지름(px). 한 손 조작 최소 터치 타겟(48) 미만으로 내리지 않는다. */
  size: number;
  /** 아이콘(도형)을 children 으로 받는다 — 확정 아이콘 자산이 없어 View 도형으로 그린다. */
  children: ReactNode;
  /**
   * 누를 수 없는 상태(준비 중 · 미지원). 터치를 막고 흐리게 그리며 스크린리더에도 알린다.
   * "왜 못 누르는지"는 버튼 밖(캡션 등)에서 함께 알려야 한다 — 흐림만으로는 이유가 없다.
   */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 원형 아이콘 버튼 (V2 시안: 정지 · 마이크). 배경/테두리는 style 로 화면에서 지정한다. */
export function CircleIconButton({
  onPress,
  accessibilityLabel,
  size,
  children,
  disabled = false,
  style,
  testID,
}: CircleIconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size },
        style,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.75,
  },
  // Button 의 disabled 와 같은 값 — 두 버튼이 같은 화면에 있을 때 흐림 정도가 갈리지 않게.
  disabled: {
    opacity: 0.4,
  },
});
