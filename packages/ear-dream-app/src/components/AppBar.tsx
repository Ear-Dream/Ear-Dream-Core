import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../constants/strings';
import { colors, fonts, spacing, touchTarget } from '../constants/theme';
import { Chevron } from './Chevron';

export interface AppBarProps {
  title: string;
  onBack: () => void;
}

/**
 * 공통 AppBar (V2 시안): 뒤로가기 chevron + 화면 제목.
 *
 * 한 손 조작 규칙(필수 조작은 하단)의 예외다 — V2 시안이 모든 화면에 뒤로가기를 상단에 두고,
 * 뒤로가기는 흐름 진행에 필수인 조작(확정·정정)이 아니라 이탈 경로라서 허용한다.
 */
export function AppBar({ title, onBack }: AppBarProps) {
  return (
    <View style={styles.root} testID="app-bar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.common.back}
        onPress={onBack}
        hitSlop={spacing.sm}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        testID="app-bar-back"
      >
        <Chevron direction="left" />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.minHeight + spacing.xs,
    gap: spacing.sm,
  },
  backButton: {
    width: touchTarget.minHeight - 8,
    height: touchTarget.minHeight - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.5,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.text.primary,
  },
});
