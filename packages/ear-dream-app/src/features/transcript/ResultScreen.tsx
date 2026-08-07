import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Waveform } from '../../components/Waveform';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';

export interface ResultScreenProps {
  /** 후보 확인에서 선택된 문장. */
  sentence: string;
  /** "처음으로 돌아가기" — 첫 화면으로. */
  onGoHome: () => void;
  /** AppBar 뒤로가기 — 인식 결과 화면으로 복귀. */
  onBack: () => void;
}

/**
 * 음성 전달 화면 (V2 시안 "음성 전달"): brand/subtle 카드 — 스피커 아이콘 + 파형 + 문장 + 캡션.
 * TTS 는 미구현이므로 "전달되고 있어요"는 표시일 뿐이다. 파형에 넘길 소리원도 아직 없어서
 * 무음(일자선)으로 그려진다 — TTS 가 붙으면 재생 레벨을 `amplitudes` 로 넘긴다.
 * 청인이 보는 화면이므로 문장은 큰 글자 · 고대비로 렌더링한다.
 */
export function ResultScreen({ sentence, onGoHome, onBack }: ResultScreenProps) {
  return (
    <ScreenFrame
      title={strings.result.appBarTitle}
      onBack={onBack}
      footer={<Button label={strings.result.backToStart} onPress={onGoHome} testID="result-home" />}
    >
      <View style={styles.card} testID="result-sentence">
        {/* 스피커 아이콘 — 확정 자산 전 placeholder 도형(인디고 원 + 스피커 모양). */}
        <View style={styles.speakerCircle} accessibilityLabel={strings.result.speakerAlt}>
          <View style={styles.speakerShape}>
            <View style={styles.speakerBody} />
            <View style={styles.speakerHorn} />
          </View>
        </View>
        <Waveform testID="result-waveform" />
        <Text style={styles.sentence}>{sentence}</Text>
        <Text style={styles.caption}>{strings.result.caption}</Text>
      </View>
    </ScreenFrame>
  );
}

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
  speakerCircle: {
    width: 88,
    height: 88,
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
});
