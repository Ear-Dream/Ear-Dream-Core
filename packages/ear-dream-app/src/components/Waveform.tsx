import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';

export interface WaveformProps {
  /** 활성(인디고) 바 색을 덮어쓸 때. 기본 brand/primary. */
  activeColor?: string;
  testID?: string;
}

/**
 * 정적 파형 바 (V2 시안: 음성 입력 · 음성 전달). 실제 오디오 레벨과 무관한 장식 mock 이다 —
 * 마이크/TTS 가 붙으면 실제 레벨로 대체하거나 제거한다.
 * 막대 높이는 시안의 형태를 눈대중으로 옮긴 값이다(왼쪽 2/3 활성, 오른쪽 비활성).
 */
export function Waveform({ activeColor = colors.brand.primary, testID }: WaveformProps) {
  return (
    <View style={styles.root} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {BAR_HEIGHTS.map((height, index) => (
        <View
          key={index}
          style={[
            styles.bar,
            {
              height,
              backgroundColor: index < ACTIVE_BAR_COUNT ? activeColor : colors.border.default,
            },
          ]}
        />
      ))}
    </View>
  );
}

const BAR_HEIGHTS = [8, 14, 22, 30, 24, 32, 26, 18, 28, 20, 12, 18, 10, 14, 8, 10, 6] as const;
const ACTIVE_BAR_COUNT = 11;

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 36,
  },
  bar: {
    width: 4,
    borderRadius: radius.pill,
  },
});
