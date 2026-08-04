/**
 * 손 랜드마크 육안 검증 뷰 — 네이티브(기본) 구현.
 *
 * MediaPipe tasks-vision 은 브라우저 WASM 기반이라 Expo Go 를 포함한 네이티브에서 동작하지 않는다.
 * T-03 시점에서는 알려진 정상 상태이므로, 실패처럼 보이지 않게 안내만 띄운다.
 * 번들러는 웹에서 CameraLandmarkView.web.tsx 를 대신 고른다.
 */
import { StyleSheet, Text, View } from 'react-native';

export function CameraLandmarkView() {
  return (
    <View style={styles.container} testID="landmark-unsupported">
      <Text style={styles.title}>웹에서만 동작합니다</Text>
      <Text style={styles.body}>
        손 랜드마크 추출은 브라우저 WASM 기반이라 Expo Go 에서는 실행되지 않습니다.
        {'\n\n'}
        터미널에서 <Text style={styles.code}>pnpm dev:web</Text> 으로 브라우저에서 확인하세요.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 12,
    backgroundColor: '#f1f3f4',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  code: {
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
