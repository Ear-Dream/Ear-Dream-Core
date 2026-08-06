import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, touchTarget } from '../constants/theme';

export type WireButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface WireButtonProps {
  label: string;
  onPress?: () => void;
  variant?: WireButtonVariant;
  disabled?: boolean;
  testID?: string;
}

/**
 * 와이어프레임 공용 버튼(회색조 pill). 확정 디자인이 붙으면 여기만 바꾼다.
 * 한 손 조작 기준(최소 터치 타겟)을 base 스타일에서 강제한다.
 */
export function WireButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  testID,
}: WireButtonProps) {
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
      <Text style={[styles.label, variant === 'ghost' && styles.ghostLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.minHeight,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  ghostLabel: {
    fontWeight: '400',
    color: colors.textSecondary,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.surfaceStrong,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});
