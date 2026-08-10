import { Pressable, StyleSheet, Text } from 'react-native';
import { CANDIDATE_ICONS } from './icons/CandidateIcons';
import { colors, fonts, radius, spacing } from '../constants/theme';

/** 셀 크기 고정. flexGrow로 늘리면 후보가 홀수일 때 마지막 칸이 가로로 늘어난다. */
export const CANDIDATE_CELL_SIZE = 104;

export interface CandidateCardProps {
  word: string;
  /** CANDIDATE_ICONS의 키. 없거나 매칭되지 않으면 글자만 보인다. */
  iconKey?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}

export function CandidateCard({ word, iconKey, selected, onPress, testID }: CandidateCardProps) {
  const Icon = iconKey ? CANDIDATE_ICONS[iconKey] : undefined;
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
  card: {
    width: CANDIDATE_CELL_SIZE,
    height: CANDIDATE_CELL_SIZE,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.brand.accent,
    backgroundColor: colors.brand.subtle,
  },
  cardPressed: { opacity: 0.85 },
  label: { fontFamily: fonts.bold, fontSize: 13 },
});