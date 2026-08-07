import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../components/Button';
import { spacing } from '../constants/theme';
import { HomeScreen } from '../features/home/HomeScreen';
import { CandidateScreen } from '../features/recognition/CandidateScreen';
import { LandmarkDevScreen } from '../features/recognition/LandmarkDevScreen';
import { RecognizingScreen } from '../features/recognition/RecognizingScreen';
import { SignInputScreen } from '../features/recognition/SignInputScreen';
import { ResultScreen } from '../features/transcript/ResultScreen';
import { SignVideoScreen } from '../features/voice/SignVideoScreen';
import { VoiceInputScreen } from '../features/voice/VoiceInputScreen';

/**
 * 화면 전환 — 단순 state 기반.
 *
 * 화면이 늘거나 딥링크/히스토리가 필요해지면 expo-router 도입을 팀과 결정한다(스킬 문서 방침).
 * 그때 갈아끼우기 쉽게 화면 컴포넌트는 네비게이션 구현을 모르고 콜백 props 만 받는다.
 *
 * 흐름 (피그마 UI v2):
 *   농인→청인: home → signInput(녹화) → 정지 → recognizing → candidates → result → home
 *   청인→농인: home → voiceInput(듣는 중 또는 키보드) → recognizing → signVideo
 *
 * V2 시안은 모든 화면에 AppBar 뒤로가기가 있어 역방향 이동은 뒤로가기로 해결한다.
 */
export type WireScreen =
  | { name: 'home' }
  | { name: 'signInput' }
  /** 인식 중 화면은 양 트랙 공용 — next 로 트랙을 구분하고 문구 컨텍스트도 여기서 나온다. */
  | { name: 'recognizing'; next: 'candidates' | 'signVideo' }
  | { name: 'candidates' }
  | { name: 'result'; sentence: string }
  | { name: 'voiceInput' }
  | { name: 'signVideo' }
  /** __DEV__ 전용: T-03 랜드마크 확인 화면. */
  | { name: 'landmarkDev' };

export function AppNavigator() {
  const [screen, setScreen] = useState<WireScreen>({ name: 'home' });

  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const goSignInput = useCallback(() => setScreen({ name: 'signInput' }), []);
  const goVoiceInput = useCallback(() => setScreen({ name: 'voiceInput' }), []);

  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          onStartSign={goSignInput}
          onStartVoice={goVoiceInput}
          onOpenLandmarkDev={__DEV__ ? () => setScreen({ name: 'landmarkDev' }) : undefined}
        />
      );
    case 'signInput':
      return (
        <SignInputScreen
          onStop={() => setScreen({ name: 'recognizing', next: 'candidates' })}
          onBack={goHome}
        />
      );
    case 'recognizing': {
      const next = screen.next;
      return (
        <RecognizingScreen
          context={next === 'candidates' ? 'sign' : 'voice'}
          onDone={() => {
            // union 분배 문제로 { name: next } 는 좁혀지지 않아 케이스별로 나눈다.
            if (next === 'candidates') setScreen({ name: 'candidates' });
            else setScreen({ name: 'signVideo' });
          }}
          onCancel={next === 'candidates' ? goSignInput : goVoiceInput}
        />
      );
    }
    case 'candidates':
      return (
        <CandidateScreen
          onConfirm={(sentence) => setScreen({ name: 'result', sentence })}
          onBack={goSignInput}
        />
      );
    case 'result':
      return (
        <ResultScreen
          sentence={screen.sentence}
          onGoHome={goHome}
          onBack={() => setScreen({ name: 'candidates' })}
        />
      );
    case 'voiceInput':
      return (
        <VoiceInputScreen
          onStopListening={() => setScreen({ name: 'recognizing', next: 'signVideo' })}
          // 입력 텍스트는 STT 미구현이라 다음 화면에서 아직 소비하지 않는다(mock).
          onTextSubmit={() => setScreen({ name: 'recognizing', next: 'signVideo' })}
          onBack={goHome}
        />
      );
    case 'signVideo':
      return <SignVideoScreen onBack={goVoiceInput} />;
    case 'landmarkDev':
      return <LandmarkDevWrapper onBack={goHome} />;
  }
}

/** 개발용 랜드마크 화면에 돌아가기 버튼만 얹는 래퍼. LandmarkDevScreen 자체는 건드리지 않는다. */
function LandmarkDevWrapper({ onBack }: { onBack: () => void }) {
  return (
    <View style={devStyles.root}>
      <View style={devStyles.body}>
        <LandmarkDevScreen />
      </View>
      <View style={devStyles.footer}>
        <Button label="처음으로" variant="outline" onPress={onBack} testID="landmark-dev-back" />
      </View>
    </View>
  );
}

const devStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  footer: {
    padding: spacing.lg,
  },
});
