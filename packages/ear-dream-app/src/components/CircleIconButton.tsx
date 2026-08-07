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
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 원형 아이콘 버튼 (V2 시안: 정지 · 마이크). 배경/테두리는 style 로 화면에서 지정한다. */
export function CircleIconButton({
  onPress,
  accessibilityLabel,
  size,
  children,
  style,
  testID,
}: CircleIconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size },
        style,
        pressed && styles.pressed,
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
});
