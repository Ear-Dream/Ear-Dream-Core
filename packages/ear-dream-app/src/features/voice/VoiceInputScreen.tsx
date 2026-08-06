import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { strings } from '../../constants/strings';
import { colors, radius, spacing, touchTarget } from '../../constants/theme';

export interface VoiceInputScreenProps {
  /** 마이크 탭 — 실제 녹음/STT 는 미구현이고 인식 중 화면으로 흐름만 진행한다(mock). */
  onMicPress: () => void;
  /** 텍스트 폴백 제출. 입력 텍스트는 아직 다음 화면에서 쓰지 않는다(mock). */
  onTextSubmit: (text: string) => void;
  onGoHome: () => void;
}

/**
 * 음성 입력 화면(청인 input, 피그마 6). 중앙 큰 마이크 버튼 + 하단 텍스트 입력 폴백.
 * 이 화면의 사용자는 청인이므로 한 손 제약은 농인 트랙만큼 엄격하지 않지만, 구성은 동일하게 하단 중심.
 */
export function VoiceInputScreen({ onMicPress, onTextSubmit, onGoHome }: VoiceInputScreenProps) {
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');

  return (
    <ScreenFrame
      footer={
        <>
          {textMode ? (
            <View style={styles.textRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={strings.voiceInput.textPlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="voice-text-input"
              />
              <WireButton
                label={strings.voiceInput.textConfirm}
                variant="secondary"
                disabled={text.trim().length === 0}
                onPress={() => onTextSubmit(text.trim())}
                testID="voice-text-confirm"
              />
            </View>
          ) : (
            <WireButton
              label={strings.voiceInput.textFallback}
              variant="secondary"
              onPress={() => setTextMode(true)}
              testID="voice-text-toggle"
            />
          )}
          <WireButton
            label={strings.common.backToHome}
            variant="ghost"
            onPress={onGoHome}
            testID="voice-home"
          />
        </>
      }
    >
      <View style={styles.center}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.voiceInput.micAlt}
          onPress={onMicPress}
          style={({ pressed }) => [styles.micButton, pressed && styles.micPressed]}
          testID="voice-mic"
        >
          <Text style={styles.micGlyph}>{strings.voiceInput.micGlyph}</Text>
        </Pressable>
        {/* 발화 유도 문구는 미확정 — 피그마 placeholder 그대로 표시 */}
        <Text style={styles.prompt}>{strings.voiceInput.speakPrompt}</Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  micButton: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceStrong,
  },
  micPressed: {
    opacity: 0.7,
  },
  micGlyph: {
    fontSize: 44,
  },
  prompt: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
    color: colors.textPrimary,
  },
});
