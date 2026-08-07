import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { WireButton } from '../../components/WireButton';
import { strings } from '../../constants/strings';
import { colors, radius, spacing, touchTarget } from '../../constants/theme';

export interface CorrectionOverlayProps {
  visible: boolean;
  /** "다시 입력" — 수어 입력 화면으로 복귀. */
  onRetry: () => void;
  /** "직접 입력" 완료 — 입력한 문장으로 결과 화면 진행. */
  onManualSubmit: (sentence: string) => void;
  onClose: () => void;
}

/**
 * 정정 오버레이(피그마 5). 오인식 시 "이 문장이 맞나요?" 위에 다시 입력 / 직접 입력 두 경로를 준다.
 * "직접 입력"의 상세 동작은 미확정이라, 와이어프레임에서는 최소 해석(문장을 타이핑해 결과로 전달)만 잇는다.
 */
export function CorrectionOverlay({ visible, onRetry, onManualSubmit, onClose }: CorrectionOverlayProps) {
  const [manualMode, setManualMode] = useState(false);
  const [text, setText] = useState('');

  // 닫힐 때 내부 상태를 초기화해 다음에 열면 처음 상태로 보이게 한다.
  useEffect(() => {
    if (!visible) {
      setManualMode(false);
      setText('');
    }
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.card} testID="correction-overlay">
          <Text style={styles.title}>{strings.correction.title}</Text>

          {manualMode ? (
            <>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={strings.correction.manualPlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="correction-manual-input"
              />
              <WireButton
                label={strings.correction.manualConfirm}
                variant="secondary"
                disabled={text.trim().length === 0}
                onPress={() => onManualSubmit(text.trim())}
                testID="correction-manual-confirm"
              />
            </>
          ) : (
            <>
              <WireButton
                label={strings.correction.retry}
                variant="secondary"
                onPress={onRetry}
                testID="correction-retry"
              />
              <WireButton
                label={strings.correction.manual}
                variant="secondary"
                onPress={() => setManualMode(true)}
                testID="correction-manual"
              />
            </>
          )}

          <WireButton
            label={strings.correction.close}
            variant="ghost"
            onPress={onClose}
            testID="correction-close"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.overlayScrim,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.overlayCard,
  },
  title: {
    marginBottom: spacing.sm,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  input: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
    color: colors.textPrimary,
  },
});
