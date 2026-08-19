import { StyleSheet, View } from 'react-native';

import { HOME_FALLBACK_COLOR } from './backgroundTint';

/**
 * 첫 화면 배경 (네이티브 기본) — 단색 폴백.
 *
 * 확정 디자인의 배경은 반복 재생되는 영상이지만 재생 구현은 웹
 * (`HomeBackground.web.tsx`)에만 있다. 네이티브에 영상을 띄우려면 expo-video 의존성이
 * 필요하고, 인식 경로 자체가 모바일 웹으로 가기로 결정돼 있어(CLAUDE.md 「모바일은
 * 네이티브가 아니라 모바일 웹으로 간다」) 지금 들일 이유가 없다.
 */
export function HomeBackground() {
  return <View style={styles.fallback} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  fallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: HOME_FALLBACK_COLOR,
  },
});
