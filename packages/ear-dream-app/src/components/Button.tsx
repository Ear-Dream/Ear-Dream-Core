import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '../constants/theme';

export type ButtonVariant = 'primary' | 'outline';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** primary = brand filled, outline = brand 테두리 (V2 시안 2종). */
  variant?: ButtonVariant;
  disabled?: boolean;
  /** 라벨 왼쪽 아이콘 슬롯 (첫 화면 트랙 버튼 등). */
  icon?: ReactNode;
  testID?: string;
}

/**
 * 공통 버튼 (확정 디자인 `Button` 컴포넌트).
 *
 * 시안이 컴포넌트 설명에 규칙을 적어 두었다 — **높이 60pt(최소 터치 타깃 48pt 초과),
 * Primary 는 화면당 1개만.** 화면마다 primary 가 여럿이면 "지금 할 일"이 흐려지므로,
 * 이탈 경로(처음으로 등)는 AppBar 의 홈 버튼이나 outline 으로 내린다.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  testID,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={[styles.label, variant === 'outline' && styles.outlineLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 60,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.4,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.bold,
    // 시안은 430pt 폭 기준 25pt 다. 좁은 화면에서 긴 라벨이 접히지 않게 한 단계 줄였다.
    fontSize: 20,
    letterSpacing: -0.3,
    color: colors.text.onBrand,
  },
  outlineLabel: {
    color: colors.brand.primary,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.brand.primary,
  },
  outline: {
    backgroundColor: colors.bg.canvas,
    borderWidth: 2,
    borderColor: colors.brand.primary,
  },
});
