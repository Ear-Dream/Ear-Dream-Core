import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { MOCK_RECOGNITION_DELAY_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, radius, spacing } from '../../constants/theme';

export interface RecognizingScreenProps {
  /** 인식 완료 시 호출. 다음 화면 결정은 네비게이터 몫이다(양 트랙 공용 화면). */
  onDone: () => void;
}

/**
 * 인식 중 화면 — 농인(수어) · 청인(음성) 트랙 공용.
 * 인식 파이프라인은 미구현이므로 타이머로 화면 전환만 시뮬레이션한다(mock.ts).
 */
export function RecognizingScreen({ onDone }: RecognizingScreenProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), MOCK_RECOGNITION_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScreenFrame>
      <View style={styles.stage} testID="recognizing-screen">
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
      <Text style={styles.label} accessibilityRole="text">
        {strings.common.recognizing}
      </Text>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceStrong,
  },
  label: {
    marginVertical: spacing.xl,
    fontSize: 18,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
