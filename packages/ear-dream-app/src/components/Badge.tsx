import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '../constants/theme';

export type BadgeVariant =
  /** 빨간 배경 + 흰 텍스트 ("● 녹화 중 00:04") */
  | 'recording'
  /** 흰 배경 + 초록 dot ("● 재생 중") */
  | 'playing'
  /** 배경 없음, 빨간 dot + 빨간 텍스트 ("● 인식 실패") */
  | 'error'
  /** 흰 말풍선 + 인디고 dot ("● 듣고 있어요") */
  | 'listening';

export interface BadgeProps {
  label: string;
  variant: BadgeVariant;
  testID?: string;
}

/** 공통 상태 배지 (V2 시안 4종). dot + 라벨 구성. */
export function Badge({ label, variant, testID }: BadgeProps) {
  const preset = presets[variant];
  return (
    <View
      style={[styles.root, preset.container]}
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={[styles.dot, { backgroundColor: preset.dotColor }]} />
      <Text style={[styles.label, { color: preset.textColor }]}>{label}</Text>
    </View>
  );
}

const presets = {
  recording: {
    container: { backgroundColor: colors.status.error },
    dotColor: colors.text.onBrand,
    textColor: colors.text.onBrand,
  },
  playing: {
    container: { backgroundColor: colors.bg.canvas },
    dotColor: colors.status.success,
    textColor: colors.text.primary,
  },
  error: {
    container: { backgroundColor: 'transparent', paddingHorizontal: 0 },
    dotColor: colors.status.error,
    textColor: colors.status.error,
  },
  listening: {
    container: {
      backgroundColor: colors.bg.canvas,
      borderWidth: 1,
      borderColor: colors.bg.surface,
    },
    dotColor: colors.brand.primary,
    textColor: colors.text.primary,
  },
} as const;

const styles = StyleSheet.create({
  root: {
    // 정렬(좌상단/중앙)은 배치하는 쪽이 정한다 — 여기서 alignSelf 를 강제하지 않는다.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 13,
  },
});
