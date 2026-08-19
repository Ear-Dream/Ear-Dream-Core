import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, maxScreenWidth, spacing } from '../constants/theme';
import { AppBar } from './AppBar';

export interface ScreenFrameProps {
  children: ReactNode;
  /** AppBar 제목. onBack 과 함께 주면 상단에 AppBar 를 그린다(첫 화면은 둘 다 생략). */
  title?: string;
  onBack?: () => void;
  /** AppBar 제목 오른쪽 조작 슬롯 (결과 화면의 홈 버튼 등). AppBar 가 그려질 때만 쓰인다. */
  headerRight?: ReactNode;
  /**
   * 하단 조작 영역. 폰을 쥔 손 엄지가 닿는 범위이므로
   * 화면의 모든 필수 조작(확정 · 정정 · 이동)은 여기에 둔다.
   */
  footer?: ReactNode;
  /**
   * AppBar · 본문 · 하단 조작 영역을 모두 덮는 오버레이(시트 · 스크림 등).
   *
   * body 가 아니라 root 의 자식이라야 하단 조작 영역까지 덮을 수 있고, 화면 전체가 아니라
   * 이 골격의 폭(maxScreenWidth) 안에 갇혀야 웹에서 시트만 창 끝까지 퍼지지 않는다.
   */
  overlay?: ReactNode;
}

/** 화면 공통 골격: AppBar / 본문 / 하단 조작 영역 (+ 전체를 덮는 오버레이). */
export function ScreenFrame({
  children,
  title,
  onBack,
  headerRight,
  footer,
  overlay,
}: ScreenFrameProps) {
  return (
    <View style={styles.root}>
      {title != null && onBack != null ? (
        <AppBar title={title} onBack={onBack} rightAction={headerRight} />
      ) : null}
      <View style={styles.body}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
      {overlay}
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
