import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { fontAssets } from './src/constants/fonts';
import { colors } from './src/constants/theme';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  // Noto Sans KR (피그마 지정 서체). CDN 이 아니라 앱에 번들해 로드한다 — 데모 현장 네트워크 비의존.
  // 파일은 한국어 서브셋이다 (pnpm setup:fonts — 3종 합 전송 8.66MB → 1.60MB).
  // 반환값을 쓰지 않는 이유는 아래 주석 참고.
  useFonts(fontAssets);

  // ⚠️ 폰트 로드를 **기다리지 않는다.**
  //
  // 원래는 `if (!fontsLoaded && !fontError) return null` 로 로드 전 빈 화면을 유지했다.
  // 근거는 "번들 폰트라 순간이다" 였는데, 그 전제는 **로컬호스트에서만 참**이다.
  // 실기기 실측(2026-08-14): 3종 합 17.7MB 를 받는 동안 화면이 하얗게 비어 있고,
  // LTE 보통 속도로 약 15초, 혼잡하면 50초까지 간다. 사용자에게는 "앱이 죽었다" 로 보인다.
  //
  // 그래서 시스템 폰트로 먼저 그리고 로드되면 교체한다(웹 표준 FOUT). 한글은 iOS·Android
  // 모두 기본 서체가 있어 읽는 데 지장이 없고, 서체가 바뀌는 편이 하얀 화면보다 낫다.
  //
  // 서브셋·woff2 는 그 뒤에 들어갔다 — 전송이 8.66MB → 1.60MB 라 기다려도 될 만한
  // 수치가 됐지만, 느린 회선에서 FOUT 가 흰 화면보다 낫다는 판단 자체는 그대로다.
  // 되돌리려면 실기기에서 교체 깜빡임과 대기 시간을 함께 재고 정하는 게 맞다.

  return (
    <SafeAreaView style={styles.container}>
      <AppNavigator />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.canvas,
  },
});
