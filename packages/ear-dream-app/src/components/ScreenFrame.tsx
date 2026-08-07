import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, maxScreenWidth, spacing } from '../constants/theme';
import { AppBar } from './AppBar';

export interface ScreenFrameProps {
  children: ReactNode;
  /** AppBar 제목. onBack 과 함께 주면 상단에 AppBar 를 그린다(첫 화면은 둘 다 생략). */
  title?: string;
  onBack?: () => void;
  /**
   * 하단 조작 영역. 폰을 쥔 손 엄지가 닿는 범위이므로
   * 화면의 모든 필수 조작(확정 · 정정 · 이동)은 여기에 둔다.
   */
  footer?: ReactNode;
}

/** 화면 공통 골격: AppBar / 본문 / 하단 조작 영역. */
export function ScreenFrame({ children, title, onBack, footer }: ScreenFrameProps) {
  return (
    <View style={styles.root}>
      {title != null && onBack != null ? <AppBar title={title} onBack={onBack} /> : null}
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
    backgroundColor: colors.bg.canvas,
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
});
