import { StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { strings } from '../../constants/strings';
import { colors, radius, spacing } from '../../constants/theme';

export interface ResultScreenProps {
  /** 후보 확인(또는 직접 입력)에서 확정된 문장. */
  sentence: string;
  /** 다시 번역 — 수어 입력 화면으로 복귀. */
  onRestart: () => void;
  onGoHome: () => void;
}

/**
 * 결과 표시 화면(피그마 4). output 은 청인이 보므로 문장을 큰 글자 · 고대비로 렌더링한다.
 * 우측 상단 스피커는 표시 전용 자리이고, "음성 재생 중..." 도 표시일 뿐 TTS 는 미구현이다.
 */
export function ResultScreen({ sentence, onRestart, onGoHome }: ResultScreenProps) {
  return (
    <ScreenFrame
      headerRight={
        <View style={styles.speakerBadge} accessibilityLabel={strings.result.speakerAlt}>
          <Text style={styles.speakerGlyph}>{strings.result.speakerGlyph}</Text>
        </View>
      }
      footer={
        <>
          <WireButton
            label={strings.result.retranslate}
            variant="secondary"
            onPress={onRestart}
            testID="result-retranslate"
          />
          <WireButton
            label={strings.common.backToHome}
            variant="ghost"
            onPress={onGoHome}
            testID="result-home"
          />
        </>
      }
    >
      <View style={styles.sentenceCard} testID="result-sentence">
        <Text style={styles.sentenceText}>{sentence}</Text>
      </View>
      {/* TTS 미구현 — 피그마 시안의 상태 문구를 표시만 한다. */}
      <Text style={styles.playing}>{strings.result.playing}</Text>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  speakerBadge: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  speakerGlyph: {
    fontSize: 18,
  },
  sentenceCard: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceStrong,
  },
  sentenceText: {
    // 청인에게 보여주는 텍스트 — 큰 글자 · 고대비.
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 38,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  playing: {
    marginVertical: spacing.lg,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
