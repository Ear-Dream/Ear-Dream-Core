import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';

import { SentenceComposerScreen } from './src/features/composer/SentenceComposerScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <SentenceComposerScreen />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});