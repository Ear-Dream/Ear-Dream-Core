import {
  NotoSansKR_400Regular,
  NotoSansKR_500Medium,
  NotoSansKR_700Bold,
  useFonts,
} from '@expo-google-fonts/noto-sans-kr';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { colors } from './src/constants/theme';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  // Noto Sans KR (피그마 지정 서체). CDN 이 아니라 앱에 번들해 로드한다 — 데모 현장 네트워크 비의존.
  const [fontsLoaded, fontError] = useFonts({
    NotoSansKR_400Regular,
    NotoSansKR_500Medium,
    NotoSansKR_700Bold,
  });

  // 로드 전에는 시스템 폰트로 잠깐 그리는 대신 빈 화면을 유지한다(번들 폰트라 순간이다).
  // 로드가 실패하면 막지 않고 시스템 폰트 fallback 으로 진행한다.
  if (!fontsLoaded && !fontError) return null;

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
