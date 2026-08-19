import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { strings } from '../constants/strings';
import { colors, fonts, spacing, touchTarget } from '../constants/theme';
import { Chevron } from './Chevron';

export interface AppBarProps {
  title: string;
  onBack: () => void;
  /**
   * 제목 오른쪽 조작 슬롯. 확정 디자인의 두 결과 화면이 여기에 홈 버튼을 둔다 —
   * 하단은 primary 버튼 하나만 남기고(시안 Button 규칙) 세션 종료는 위로 올린 배치다.
   */
  rightAction?: ReactNode;
}

/**
 * 공통 AppBar (V2 시안): 뒤로가기 chevron + 화면 제목.
 *
 * 한 손 조작 규칙(필수 조작은 하단)의 예외다 — V2 시안이 모든 화면에 뒤로가기를 상단에 두고,
 * 뒤로가기는 흐름 진행에 필수인 조작(확정·정정)이 아니라 이탈 경로라서 허용한다.
 */
export function AppBar({ title, onBack, rightAction }: AppBarProps) {
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
      {rightAction}
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
    // 확정 디자인 실측: Noto Sans KR Bold 20 / 자간 -1.5%.
    fontSize: 20,
    letterSpacing: -0.3,
    color: colors.text.primary,
  },
});
