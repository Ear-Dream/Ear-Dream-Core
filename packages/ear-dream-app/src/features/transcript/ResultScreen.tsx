import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Ripple } from '../../components/Ripple';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import { useSpeech } from './speech';

export interface ResultScreenProps {
  /** 모은 단어로 만든 전달 문장. */
  sentence: string;
  /** "처음으로 돌아가기" — 첫 화면으로. */
  onGoHome: () => void;
  /** AppBar 뒤로가기 — 단어를 더 고치러 촬영 화면으로 복귀. */
  onBack: () => void;
}

/**
 * 음성 전달 화면 (V2 시안 "음성 전달"): brand/subtle 카드 — 스피커 아이콘 + 문장 + 캡션.
 *
 * 화면에 들어오면 문장을 실제로 읽는다(웹 SpeechSynthesis). 폰을 든 사람은 그 소리를 듣지
 * 못하므로 "지금 말하고 있어요"를 눈으로도 보여준다 — 소리로만 전달되는 피드백을 만들지
 * 않는다는 원칙이다. 청인이 읽는 문장이라 큰 글자 · 고대비로 렌더링한다.
 *
 * 시안에 있던 파형은 뺐다. SpeechSynthesis 는 오디오 레벨을 노출하지 않아 재생 중인 소리의
 * 파형을 진짜로 그릴 수 없다. 아무 관계 없는 움직임을 파형인 척 흔드느니, 소리가 나가는
 * 중이라는 사실만 물결로 표시한다. 재생 레벨을 읽을 수 있게 되면 파형을 되살린다.
 */
export function ResultScreen({ sentence, onGoHome, onBack }: ResultScreenProps) {
  const { status, speak, error } = useSpeech(sentence);
  const speaking = status === 'speaking';
  const unavailable = status === 'unsupported' || status === 'error';

  return (
    <ScreenFrame
      title={strings.result.appBarTitle}
      onBack={onBack}
      footer={
        <>
          <Button
            label={strings.result.replay}
            variant="outline"
            disabled={status === 'unsupported'}
            onPress={speak}
            testID="result-replay"
          />
          <Button
            label={strings.result.backToStart}
            onPress={onGoHome}
            testID="result-home"
          />
        </>
      }
    >
      <View style={styles.card} testID="result-sentence">
        <View style={styles.speakerStage}>
          {/* 스피커 아이콘 — 확정 자산 전 placeholder 도형(인디고 원 + 스피커 모양). */}
          <View style={styles.speakerCircle} accessibilityLabel={strings.result.speakerAlt}>
            <View style={styles.speakerShape}>
              <View style={styles.speakerBody} />
              <View style={styles.speakerHorn} />
            </View>
          </View>
          {/* 소리가 나가는 중이라는 표시. 재생이 끝나면 멈춘다. */}
          <Ripple
            size={SPEAKER_RIPPLE_SIZE}
            startScale={SPEAKER_SIZE / SPEAKER_RIPPLE_SIZE}
            active={speaking}
            testID="result-ripple"
          />
        </View>

        <Text style={styles.sentence}>{sentence}</Text>

        <Text style={[styles.caption, unavailable && styles.captionWarning]}>
          {unavailable
            ? (error ?? strings.result.speechUnavailable)
            : speaking
              ? strings.result.speaking
              : strings.result.caption}
        </Text>
      </View>
    </ScreenFrame>
  );
}

const SPEAKER_SIZE = 88;
/** 물결이 가장 멀리 퍼졌을 때의 지름. */
const SPEAKER_RIPPLE_SIZE = 176;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.subtle,
  },
  speakerStage: {
    width: SPEAKER_RIPPLE_SIZE,
    height: SPEAKER_RIPPLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerCircle: {
    width: SPEAKER_SIZE,
    height: SPEAKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
  },
  speakerShape: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  speakerBody: {
    width: 10,
    height: 14,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    backgroundColor: colors.text.onBrand,
  },
  speakerHorn: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderRightWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: colors.text.onBrand,
  },
  sentence: {
    // 청인에게 보여주는 텍스트 — 큰 글자 · 고대비.
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 40,
    color: colors.text.primary,
    textAlign: 'center',
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  captionWarning: {
    color: colors.status.error,
  },
});
