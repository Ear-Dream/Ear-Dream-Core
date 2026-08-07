import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing, touchTarget } from '../constants/theme';
import { Chevron } from './Chevron';

export interface CandidateRowProps {
  sentence: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * 인식 결과 후보 행 (V2 시안): 좌측 원형 썸네일 자리(선택 시 라디오 dot 처럼 인디고),
 * 문장 라벨, 우측 chevron. 선택된 행은 brand/subtle 배경 + brand 테두리.
 */
export function CandidateRow({ sentence, selected, onPress, testID }: CandidateRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sentence}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.root, selected && styles.rootSelected, pressed && styles.pressed]}
      testID={testID}
    >
      {/* 원형 썸네일 자리 — 수어 영상 썸네일 확정 전 placeholder. 선택 표시를 겸한다. */}
      <View style={styles.thumb}>
        <View style={[styles.thumbDot, selected && styles.thumbDotSelected]} />
      </View>
      <Text style={styles.sentence}>{sentence}</Text>
      <Chevron direction="right" size={10} color={selected ? colors.brand.primary : colors.border.default} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: touchTarget.minHeight * 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  rootSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.subtle,
  },
  pressed: {
    opacity: 0.8,
  },
  thumb: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.bg.canvas,
    borderWidth: 1,
    borderColor: colors.bg.surface,
  },
  thumbDot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.overlay,
  },
  thumbDotSelected: {
    backgroundColor: colors.brand.primary,
  },
  sentence: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 24,
    color: colors.text.primary,
  },
});
