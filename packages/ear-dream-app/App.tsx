import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { LandmarkDevScreen } from './src/features/recognition/LandmarkDevScreen';

// M0 단계라 진입점이 곧 개발용 확인 화면이다. 화면이 여러 개 필요해지면
// expo-router 도입을 팀과 결정한다(미도입).
export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <LandmarkDevScreen />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
