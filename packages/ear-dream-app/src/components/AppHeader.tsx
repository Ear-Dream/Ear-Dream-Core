import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { strings } from '../constants/strings';
import { colors, spacing } from '../constants/theme';

/**
 * 공통 헤더: 좌측 로고 자리(구름+달 아이콘 확정 전 placeholder) + "Ear Dream".
 * 헤더는 표시 전용이다 — 한 손 조작 규칙상 필수 조작을 상단에 두지 않으므로
 * rightSlot 에는 장식/상태 표시(예: 결과 화면의 스피커 자리)만 올린다.
 */
export function AppHeader({ rightSlot }: { rightSlot?: ReactNode }) {
  return (
    <View style={styles.root} testID="app-header">
      <View style={styles.brand} accessibilityLabel={strings.common.logoAlt}>
        <Text style={styles.logoGlyph}>{strings.common.logoGlyph}</Text>
        <Text style={styles.title}>{strings.common.appName}</Text>
      </View>
      {rightSlot ? <View>{rightSlot}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  logoGlyph: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
