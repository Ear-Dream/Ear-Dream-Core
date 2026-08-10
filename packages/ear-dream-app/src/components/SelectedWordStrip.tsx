import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MockCandidateWord } from '../constants/mock';
import { strings } from '../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../constants/theme';
import { Chevron } from './Chevron';

export interface SelectedWordStripProps {
  /** 지금까지 고른 단어들. 고른 순서 그대로다. */
  items: readonly MockCandidateWord[];
  /**
   * 칩의 × — id 가 아니라 **위치**로 지운다. 같은 단어를 두 번 고를 수 있어서
   * (예: "가다 ... 가다") id 로 지우면 엉뚱한 칩이 사라진다.
   */
  onRemove: (index: number) => void;
  /** "결과 확인" — 모은 단어로 문장 화면으로 넘어간다. */
  onComplete: () => void;
  testID?: string;
}

/**
 * 촬영 화면 하단의 단어 스트립.
 *
 * 촬영 → 후보에서 단어 선택을 반복하며 고른 단어가 여기에 쌓이고, "결과 확인"으로 마친다.
 * 오인식 정정 경로(칩의 ×)를 숨은 메뉴가 아니라 항상 보이게 둔 자리이기도 하다.
 *
 * 단어가 늘면 가로로 스크롤한다 — 줄바꿈으로 쌓으면 뷰파인더를 밀어내서 촬영 구도가 계속
 * 바뀐다. "결과 확인"은 스크롤과 무관하게 오른쪽에 고정되어 언제나 엄지에 닿는다.
 */
export function SelectedWordStrip({
  items,
  onRemove,
  onComplete,
  testID,
}: SelectedWordStripProps) {
  const empty = items.length === 0;

  return (
    <View style={styles.root} testID={testID}>
      {empty ? (
        <Text style={styles.emptyHint}>{strings.signInput.wordsEmpty}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsViewport}
        >
          {items.map((candidate, index) => {
            // 같은 단어가 여러 번 들어올 수 있어 id 만으로는 key 가 겹친다.
            const key = `${candidate.id}-${index}`;
            // 방금 더한 단어를 강조한다. 시안은 첫 칩이 강조돼 있지만, 뒤로 쌓이기만 하는
            // 목록에서 첫 자리를 강조할 이유가 없어 "가장 최근"으로 읽었다.
            const latest = index === items.length - 1;

            return (
              <View key={key} style={[styles.chip, latest && styles.chipLatest]}>
                <Text style={styles.chipLabel} numberOfLines={1}>
                  {candidate.word}
                </Text>
                <Pressable
                  onPress={() => onRemove(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`${candidate.word} ${strings.signInput.wordRemoveAlt}`}
                  // 칩 자체를 누르면 지워지게 하면 스크롤하다 잘못 스쳐 지운다. × 만 받되
                  // 눈에 보이는 크기보다 넓게 잡아 한 손 조작 최소 타겟을 맞춘다.
                  hitSlop={REMOVE_HIT_SLOP}
                  testID={`sign-input-word-remove-${index}`}
                >
                  <Text style={styles.chipRemove}>×</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Pressable
        onPress={onComplete}
        disabled={empty}
        accessibilityRole="button"
        accessibilityState={{ disabled: empty }}
        accessibilityLabel={strings.signInput.wordsDone}
        style={({ pressed }) => [
          styles.done,
          empty && styles.doneDisabled,
          pressed && styles.donePressed,
        ]}
        testID="sign-input-words-done"
      >
        <Text style={styles.doneLabel}>{strings.signInput.wordsDone}</Text>
        <Chevron direction="right" size={10} color={colors.text.onBrand} />
      </Pressable>
    </View>
  );
}

const REMOVE_HIT_SLOP = { top: 12, right: 12, bottom: 12, left: 8 };

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brand.subtle,
  },
  // flexShrink 로 남는 폭만 차지하게 둔다 — "결과 확인" 이 칩에 밀려 잘리면 안 된다.
  chipsViewport: {
    flexShrink: 1,
  },
  chips: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  chipLatest: {
    borderWidth: 2,
    borderColor: colors.brand.accent,
  },
  chipLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.text.primary,
  },
  chipRemove: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 18,
    color: colors.text.secondary,
  },
  emptyHint: {
    flexShrink: 1,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: 'auto',
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.brand.primary,
  },
  doneDisabled: {
    opacity: 0.45,
  },
  donePressed: {
    opacity: 0.85,
  },
  doneLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text.onBrand,
  },
});
