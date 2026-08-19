import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '../../constants/theme';

export interface EntryButtonProps {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  testID?: string;
}

/**
 * 첫 화면 트랙 진입 버튼 (확정 디자인 `Entry — 수어로/구어로 시작하기`).
 *
 * 공통 `Button` 과 별개인 이유는 서는 자리가 다르기 때문이다 — 이 버튼은 **영상 배경
 * 위**에 놓이는 흰 pill 이고, 나머지 화면의 Button 은 흰 캔버스 위의 인디고 pill 이다.
 * 배색을 variant 로 합치면 "배경이 어두울 때만 쓰는 변형"이라는 조건이 타입에서 사라진다.
 *
 * ⚠️ 치수는 시안(430pt 폭 기준 H88 · 라벨 Bold 32 · 좌 패딩 50)을 **좁은 화면에 맞춰
 * 줄인 값**이다. 시안 값을 그대로 쓰면 375pt 폭에서 라벨이 두 줄로 접힌다. 높이 88 과
 * pill 반경은 그대로 두었다 — 한 손 조작 기준 터치 타겟이라 줄일 이유가 없다.
 */
export function EntryButton({ label, icon, onPress, testID }: EntryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <View style={styles.icon}>{icon}</View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 아이콘 슬롯 한 변 — 확정 애셋이 들어와도 이 크기를 유지한다. */
export const ENTRY_ICON_SIZE = 44;

const styles = StyleSheet.create({
  root: {
    height: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingLeft: spacing.xl + spacing.lg,
    paddingRight: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  pressed: {
    opacity: 0.85,
  },
  icon: {
    width: ENTRY_ICON_SIZE,
    height: ENTRY_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: -0.4,
    color: colors.text.primary,
  },
});
