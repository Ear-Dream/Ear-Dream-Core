import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { MOCK_NEXT_WORDS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, radius, spacing, touchTarget } from '../../constants/theme';

export interface SentenceComposerScreenProps {
  onGoHome?: () => void;
}

/**
 * 자유 발화(문장 조합) 화면 — 피그마 8.
 *
 * 수어 동작 미리보기 카드 + 다음 단어 추천 + 재생 속도 + 말하기/추가.
 * 전부 목업이다: 동작 영상 · 단어 추천 · TTS("말하기") · 재생 속도 조절은 미구현이고,
 * "추가"로 단어를 이어 붙이는 흐름만 동작한다. 단어 목록은 mock.ts 의 예시다.
 */
export function SentenceComposerScreen({ onGoHome }: SentenceComposerScreenProps = {}) {
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [composedWords, setComposedWords] = useState<readonly string[]>([]);

  const addSelectedWord = () => {
    if (selectedWord == null) return;
    setComposedWords((words) => [...words, selectedWord]);
  };

  return (
    <ScreenFrame
      showHeader={false}
      footer={
        <>
          <View style={styles.actionRow}>
            {/* TTS 미구현 — 피그마에서도 비활성 스타일. placeholder 로 비활성 처리 */}
            <View style={styles.actionItem}>
              <WireButton
                label={strings.composer.speak}
                variant="secondary"
                disabled
                testID="composer-speak"
              />
            </View>
            <View style={styles.actionItem}>
              <WireButton
                label={strings.composer.add}
                disabled={selectedWord == null}
                onPress={addSelectedWord}
                testID="composer-add"
              />
            </View>
          </View>
          {onGoHome ? (
            <WireButton
              label={strings.common.backToHome}
              variant="ghost"
              onPress={onGoHome}
              testID="composer-home"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{strings.composer.title}</Text>
          <Text style={styles.subtitle}>{strings.composer.subtitle}</Text>
        </View>
        {/* 상단 우측 + 버튼 자리 — 동작 미정 placeholder (조작 아님) */}
        <Text style={styles.addSymbol}>{strings.composer.addSymbol}</Text>
      </View>

      {/* 조합 결과 확인 줄. 피그마에는 없지만 "추가" 흐름을 눈으로 확인하기 위한 와이어프레임 보조 요소다. */}
      <Text style={styles.composedLine} testID="composer-composed">
        {composedWords.length > 0
          ? `${strings.composer.composedLabel}: ${composedWords.join(' ')}`
          : strings.composer.composedEmpty}
      </Text>

      <View style={styles.motionCard} testID="composer-motion-card">
        <Text style={styles.motionCaption}>
          {selectedWord ?? strings.composer.motionCaptionEmpty}
        </Text>
        <Text style={styles.motionTitle}>{strings.composer.motionTitle}</Text>
      </View>

      <Text style={styles.sectionLabel}>{strings.composer.nextWords}</Text>
      <View style={styles.wordRow}>
        {MOCK_NEXT_WORDS.map((word) => {
          const selected = word === selectedWord;
          return (
            <Pressable
              key={word}
              accessibilityRole="button"
              accessibilityLabel={word}
              accessibilityState={{ selected }}
              onPress={() => setSelectedWord(word)}
              style={[styles.wordChip, selected && styles.wordChipSelected]}
              testID={`composer-word-${word}`}
            >
              <Text style={styles.wordText}>{word}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>{strings.composer.speed}</Text>
      {/* 재생 속도 슬라이더 — 시각 placeholder. 조작은 미구현이며 값도 미확정이다. */}
      <View style={styles.sliderTrack} testID="composer-speed-slider">
        <View style={styles.sliderThumb} />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
  },
  headerText: {
    gap: spacing.xs,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  addSymbol: {
    fontSize: 24,
    color: colors.textMuted,
  },
  composedLine: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.textSecondary,
  },
  motionCard: {
    flex: 1,
    marginTop: spacing.md,
    justifyContent: 'flex-end',
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceStrong,
  },
  motionCaption: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  motionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  wordRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  wordChip: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  wordChipSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderStrong,
  },
  wordText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sliderTrack: {
    height: 4,
    marginVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    justifyContent: 'center',
  },
  sliderThumb: {
    position: 'absolute',
    left: '50%',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionItem: {
    flex: 1,
  },
});
