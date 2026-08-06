import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { MOCK_CANDIDATE_SENTENCES } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, radius, spacing, touchTarget } from '../../constants/theme';
import { CorrectionOverlay } from './CorrectionOverlay';

export interface CandidateScreenProps {
  /** 후보 선택 확정 또는 정정 오버레이의 직접 입력 완료. */
  onConfirm: (sentence: string) => void;
  /** 정정 "다시 입력" — 수어 입력 화면으로 복귀. */
  onRetry: () => void;
  onGoHome: () => void;
}

/**
 * 후보 확인 화면(피그마 3). 후보 문장 카드에서 하나를 고르고 하단 버튼으로 확정한다.
 * 후보는 목업이며 개수 N 도 미확정이다(mock.ts). 오인식 정정 경로는 항상 화면에 보이게 둔다.
 */
export function CandidateScreen({ onConfirm, onRetry, onGoHome }: CandidateScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [correctionVisible, setCorrectionVisible] = useState(false);

  const selectedSentence = selectedIndex === null ? null : MOCK_CANDIDATE_SENTENCES[selectedIndex];

  return (
    <ScreenFrame
      footer={
        <>
          <WireButton
            label={strings.candidates.notFound}
            variant="ghost"
            onPress={() => setCorrectionVisible(true)}
            testID="candidates-not-found"
          />
          <WireButton
            label={strings.candidates.confirm}
            disabled={selectedSentence == null}
            onPress={() => {
              if (selectedSentence != null) onConfirm(selectedSentence);
            }}
            testID="candidates-confirm"
          />
          <WireButton
            label={strings.common.backToHome}
            variant="ghost"
            onPress={onGoHome}
            testID="candidates-home"
          />
        </>
      }
    >
      {/* 카드 목록은 아래쪽에 몰아 왼손 엄지 도달 범위에 가깝게 둔다. */}
      <View style={styles.list}>
        {MOCK_CANDIDATE_SENTENCES.map((sentence, index) => {
          const selected = index === selectedIndex;
          return (
            <Pressable
              key={sentence}
              accessibilityRole="button"
              accessibilityLabel={sentence}
              accessibilityState={{ selected }}
              onPress={() => setSelectedIndex(index)}
              style={[styles.card, selected && styles.cardSelected]}
              testID={`candidates-card-${index}`}
            >
              <Text style={styles.cardText}>{sentence}</Text>
            </Pressable>
          );
        })}
      </View>

      <CorrectionOverlay
        visible={correctionVisible}
        onRetry={onRetry}
        onManualSubmit={onConfirm}
        onClose={() => setCorrectionVisible(false)}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  card: {
    minHeight: touchTarget.minHeight * 1.7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderStrong,
  },
  cardText: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 26,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
