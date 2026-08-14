// 패키지 루트가 아니라 **굵기별 서브패스**에서 가져온다.
// 루트 index.js 는 9종 전부를 require 하므로 그대로 두면 쓰지도 않는 6종(약 35MB)이
// 번들·export 에 실린다 (실측: dist 폰트 53.1MB → 서브패스로 17.7MB).
import { NotoSansKR_400Regular } from '@expo-google-fonts/noto-sans-kr/400Regular';
import { NotoSansKR_500Medium } from '@expo-google-fonts/noto-sans-kr/500Medium';
import { NotoSansKR_700Bold } from '@expo-google-fonts/noto-sans-kr/700Bold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { colors } from './src/constants/theme';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  // Noto Sans KR (피그마 지정 서체). CDN 이 아니라 앱에 번들해 로드한다 — 데모 현장 네트워크 비의존.
  // 반환값을 쓰지 않는 이유는 아래 주석 참고.
  useFonts({
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
  });

  // ⚠️ 폰트 로드를 **기다리지 않는다.**
  //
  // 원래는 `if (!fontsLoaded && !fontError) return null` 로 로드 전 빈 화면을 유지했다.
  // 근거는 "번들 폰트라 순간이다" 였는데, 그 전제는 **로컬호스트에서만 참**이다.
  // 실기기 실측(2026-08-14): 3종 합 17.7MB 를 받는 동안 화면이 하얗게 비어 있고,
  // LTE 보통 속도로 약 15초, 혼잡하면 50초까지 간다. 사용자에게는 "앱이 죽었다" 로 보인다.
  //
  // 그래서 시스템 폰트로 먼저 그리고 로드되면 교체한다(웹 표준 FOUT). 한글은 iOS·Android
  // 모두 기본 서체가 있어 읽는 데 지장이 없고, 서체가 바뀌는 편이 하얀 화면보다 낫다.
  // 근본 해결(서브셋·woff2 로 용량 줄이기)은 별건이다 — 그때 이 결정을 재검토한다.

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
