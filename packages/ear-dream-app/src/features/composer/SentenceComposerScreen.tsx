import { StyleSheet, Text, View } from 'react-native';

export function SentenceComposerScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>문장 만들기 화면</Text>

      <Text style={styles.description}>
        후보 단어를 선택해서 문장을 만드는 페이지입니다.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },

  title: {
    marginBottom: 12,
    fontSize: 24,
    fontWeight: '700',
    color: '#111111',
  },

  description: {
    fontSize: 16,
    color: '#555555',
  },
});
