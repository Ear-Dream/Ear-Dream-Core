import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, maxScreenWidth, spacing } from '../constants/theme';
import { AppHeader } from './AppHeader';

export interface ScreenFrameProps {
  children: ReactNode;
  /** 헤더 우측 표시 전용 슬롯(조작 요소를 올리지 않는다 — 한 손 조작 규칙). */
  headerRight?: ReactNode;
  /**
   * 하단 조작 영역. 폰을 쥔 왼손 엄지가 닿는 범위이므로
   * 화면의 모든 필수 조작(확정 · 정정 · 이동)은 여기에 둔다.
   */
  footer?: ReactNode;
  showHeader?: boolean;
}

/** 화면 공통 골격: 헤더(표시 전용) / 본문 / 하단 조작 영역. */
export function ScreenFrame({ children, headerRight, footer, showHeader = true }: ScreenFrameProps) {
  return (
    <View style={styles.root}>
      {showHeader ? <AppHeader rightSlot={headerRight} /> : null}
      <View style={styles.body}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    // 피그마 시안이 폰 세로(430pt) 기준이라 웹에서 구도가 퍼지지 않게 폭을 제한한다.
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
});
