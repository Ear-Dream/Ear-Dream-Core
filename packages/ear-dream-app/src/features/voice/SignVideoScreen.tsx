import { StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { strings } from '../../constants/strings';
import { colors, radius, spacing } from '../../constants/theme';

export interface SignVideoScreenProps {
  /** 다시 말하기 — 음성 입력 화면으로 복귀. */
  onSpeakAgain: () => void;
  onGoHome: () => void;
}

/**
 * 수어 영상 출력 화면(피그마 7). 정해진 수어 영상이 재생될 자리의 placeholder.
 * 영상 재생과 STT 결과 텍스트는 미구현이므로 자리만 잡는다.
 */
export function SignVideoScreen({ onSpeakAgain, onGoHome }: SignVideoScreenProps) {
  return (
    <ScreenFrame
      footer={
        <>
          <WireButton
            label={strings.signVideo.speakAgain}
            onPress={onSpeakAgain}
            testID="sign-video-again"
          />
          <WireButton
            label={strings.common.backToHome}
            variant="ghost"
            onPress={onGoHome}
            testID="sign-video-home"
          />
        </>
      }
    >
      <View style={styles.videoArea} testID="sign-video-placeholder">
        <Text style={styles.videoText}>{strings.signVideo.videoPlaceholder}</Text>
      </View>
      {/* 인식된 문장이 표시될 자리 — 피그마의 하단 "텍스트" placeholder */}
      <View style={styles.textSlot}>
        <Text style={styles.textSlotLabel}>{strings.signVideo.textSlot}</Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  videoArea: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceStrong,
  },
  videoText: {
    fontSize: 17,
    lineHeight: 26,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  textSlot: {
    marginVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  textSlotLabel: {
    fontSize: 15,
    color: colors.textMuted,
  },
});
