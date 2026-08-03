import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PresetPhrase } from '@ear-dream/core';

import { api } from './src/api';

export default function App() {
  const [phrases, setPhrases] = useState<PresetPhrase[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .GET('/api/v1/phrases', { params: { query: {} } })
      .then(({ data, error }) => {
        if (error) {
          setError('API 응답 오류');
          return;
        }
        setPhrases(data ?? []);
      })
      .catch(() => setError('API 서버에 연결할 수 없습니다'));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ear Dream</Text>
      <Text>{error ?? `상황 문장 ${phrases.length}개 로드됨`}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
  },
});
