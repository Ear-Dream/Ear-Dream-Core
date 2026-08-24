import { Pressable, StyleSheet, Text } from 'react-native';
import { candidateIconFor } from './icons/CandidateIcons';
import { colors, fonts, radius, spacing } from '../constants/theme';

/** 셀 크기 고정. flexGrow로 늘리면 후보가 홀수일 때 마지막 칸이 가로로 늘어난다. */
/**
 * 후보 카드 한 칸 — 시안 실측 177.14 x 145.6 (460:2528). 정사각이 아니다.
 * 2열 그리드에서 좌우 여백(16)과 칸 사이(16)를 빼면 430pt 프레임에서 딱 맞는 폭이다.
 */
export const CANDIDATE_CELL_WIDTH = 177.137;
export const CANDIDATE_CELL_HEIGHT = 145.598;

export interface CandidateCardProps {
  word: string;
  /** 픽토그램을 찾을 어휘 라벨. 매칭되는 그림이 없으면 글자만 보인다. */
  iconKey?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function CandidateCard({ word, iconKey, selected, onPress, testID }: CandidateCardProps) {
  const Icon = iconKey ? candidateIconFor(iconKey) : undefined;
  const tint = selected ? colors.brand.accent : colors.text.primary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={word}
      testID={testID}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
      ]}
    >
      {Icon ? <Icon size={30} color={tint} /> : null}
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {word}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 시안 실측: 반경 12 · 테두리 2 (선택 여부와 무관하게 굵기는 같고 색만 갈린다).
  card: {
    width: CANDIDATE_CELL_WIDTH,
    height: CANDIDATE_CELL_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  cardSelected: {
    borderColor: colors.brand.accent,
    backgroundColor: colors.brand.subtle,
  },
  cardPressed: { opacity: 0.85 },
  // 시안 실측: Bold 25 / 행간 140% / 자간 -0.375 (460:2529).
  label: {
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 25 * 1.4,
    letterSpacing: -0.375,
  },
});