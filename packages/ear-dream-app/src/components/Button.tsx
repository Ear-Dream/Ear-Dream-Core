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
 * 공통 버튼 (V2 시안). 한 손 조작 기준 최소 터치 타겟을 base 스타일에서 강제한다.
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
    minHeight: 52,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
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
    fontFamily: fonts.medium,
    fontSize: 16,
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
    borderWidth: 1.5,
    borderColor: colors.brand.primary,
  },
});
