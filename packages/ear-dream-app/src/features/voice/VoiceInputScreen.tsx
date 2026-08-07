import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CircleIconButton } from '../../components/CircleIconButton';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Waveform } from '../../components/Waveform';
import { VOICE_LISTEN_TIMEOUT_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';

export interface VoiceInputScreenProps {
  /** 듣는 중 상태에서 정지 탭 — 실제 녹음/STT 는 미구현이고 인식 중 화면으로 흐름만 진행한다(mock). */
  onStopListening: () => void;
  /** 키보드 폴백 제출. 입력 텍스트는 STT 미구현이라 다음 화면에서 아직 소비하지 않는다(mock). */
  onTextSubmit: (text: string) => void;
  onBack: () => void;
}

/**
 * 음성 입력 화면 (V2 시안 "음성 입력"): 동심원 + 마이크 버튼 + 파형 + 키보드 폴백.
 *
 * - idle ↔ 듣는 중: 마이크 탭으로 전환. 듣는 중에는 버튼이 빨간 정지 사각형으로 바뀌고
 *   "● 듣고 있어요" 배지가 붙는다. 듣는 중에서 정지 탭 → 인식 중 → 수어로 보기.
 * - 타임아웃: 시안 주석 "음성 인식 시간(10초 이내)로 인식하지 못하면 다시 해달라는 알림창
 *   → 프론트에서 처리". 듣는 중이 10초(임시값, mock.ts) 지속되면 알림을 띄우고 idle 로
 *   복귀하는 mock 이다. RN 의 Alert.alert 는 웹에서 동작하지 않아 인앱 Modal 로 구현했다.
 */
export function VoiceInputScreen({ onStopListening, onTextSubmit, onBack }: VoiceInputScreenProps) {
  const [listening, setListening] = useState(false);
  const [timeoutVisible, setTimeoutVisible] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!listening) return;
    const timer = setTimeout(() => {
      setListening(false);
      setTimeoutVisible(true);
    }, VOICE_LISTEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [listening]);

  return (
    <ScreenFrame
      title={strings.voiceInput.appBarTitle}
      onBack={onBack}
      footer={
        <>
          <Text style={styles.noiseCaption}>{strings.voiceInput.noiseCaption}</Text>
          {textMode ? (
            <View style={styles.textRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={strings.voiceInput.textPlaceholder}
                placeholderTextColor={colors.border.default}
                style={styles.input}
                testID="voice-text-input"
              />
              <Button
                label={strings.voiceInput.textConfirm}
                variant="outline"
                disabled={text.trim().length === 0}
                onPress={() => onTextSubmit(text.trim())}
                testID="voice-text-confirm"
              />
            </View>
          ) : (
            <Button
              label={strings.voiceInput.keyboardFallback}
              variant="outline"
              onPress={() => setTextMode(true)}
              testID="voice-text-toggle"
            />
          )}
        </>
      }
    >
      <View style={styles.center}>
        <Text style={styles.title}>{strings.voiceInput.title}</Text>
        <Text style={styles.subtitle}>{strings.voiceInput.subtitle}</Text>

        {/* 동심원 3겹 + 중앙 마이크/정지 버튼. 듣는 중에는 최외곽에 빨간 링. */}
        <View style={[styles.ringOuter, listening && styles.ringOuterListening]}>
          <View style={styles.ringInner}>
            <CircleIconButton
              onPress={listening ? onStopListening : () => setListening(true)}
              accessibilityLabel={listening ? strings.voiceInput.stopAlt : strings.voiceInput.micAlt}
              size={104}
              style={[styles.micButton, listening && styles.micButtonListening]}
              testID="voice-mic"
            >
              {listening ? (
                <View style={styles.stopSquare} />
              ) : (
                // 마이크 아이콘 — 확정 자산 전 placeholder 도형(캡슐 + 받침).
                <View style={styles.micShape}>
                  <View style={styles.micCapsule} />
                  <View style={styles.micStand} />
                </View>
              )}
            </CircleIconButton>
          </View>
        </View>

        {listening ? (
          <Badge
            label={strings.voiceInput.listeningBadge}
            variant="listening"
            testID="voice-listening-badge"
          />
        ) : null}

        <Waveform testID="voice-waveform" />
      </View>

      {/* 타임아웃 알림 — 웹에서 Alert.alert 가 no-op 이라 인앱 Modal 을 쓴다. */}
      <Modal visible={timeoutVisible} transparent animationType="fade">
        <View style={styles.modalScrim}>
          <View style={styles.modalCard} testID="voice-timeout-modal">
            <Text style={styles.modalTitle}>{strings.voiceInput.timeoutTitle}</Text>
            <Text style={styles.modalBody}>{strings.voiceInput.timeoutBody}</Text>
            <Button
              label={strings.voiceInput.timeoutConfirm}
              onPress={() => setTimeoutVisible(false)}
              testID="voice-timeout-confirm"
            />
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  ringOuter: {
    width: 208,
    height: 208,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.subtle,
  },
  ringOuterListening: {
    borderWidth: 3,
    borderColor: colors.status.errorSoft,
  },
  ringInner: {
    width: 156,
    height: 156,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    // brand/subtle 보다 한 단계 진한 중간 링 — 시안 관측 근사값(동심원 그라데이션 대용).
    backgroundColor: '#dfe3fc',
  },
  micButton: {
    backgroundColor: colors.brand.primary,
  },
  micButtonListening: {
    borderWidth: 3,
    borderColor: colors.status.error,
  },
  micShape: {
    alignItems: 'center',
    gap: 3,
  },
  micCapsule: {
    width: 20,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.text.onBrand,
  },
  micStand: {
    width: 32,
    height: 14,
    borderWidth: 3,
    borderTopWidth: 0,
    borderColor: colors.text.onBrand,
    borderBottomLeftRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
  stopSquare: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.status.error,
  },
  noiseCaption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  textRow: {
    gap: spacing.sm,
  },
  input: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text.primary,
  },
  modalScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(11, 15, 20, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.canvas,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.text.primary,
    textAlign: 'center',
  },
  modalBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
