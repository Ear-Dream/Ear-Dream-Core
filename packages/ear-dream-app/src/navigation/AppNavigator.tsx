import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../components/Button';
import { composeMockSentence, type MockCandidateWord } from '../constants/mock';
import { spacing } from '../constants/theme';
import { HomeScreen } from '../features/home/HomeScreen';
import { LandmarkDevScreen } from '../features/recognition/LandmarkDevScreen';
import { RecognizingScreen } from '../features/recognition/RecognizingScreen';
import { SignInputScreen, type SignInputPhase } from '../features/recognition/SignInputScreen';
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
 *   농인→청인: home → signInput(녹화) → 정지 → recognizing → signInput(후보 시트)
 *              → 단어 선택 → 다시 signInput(녹화) ... 반복 → "결과 확인" → result → home
 *   청인→농인: home → voiceInput(듣는 중 또는 키보드) → recognizing → signVideo
 *
 * 후보 선택은 라우트가 아니라 signInput 의 한 단계(phase)다. 시트 뒤에서 카메라가 살아 있어야
 * "취소하고 다시 찍기"가 재획득 없이 즉시 동작하기 때문이다.
 *
 * 고른 단어 목록은 signInput 이 아니라 여기가 들고 있다. 한 단어를 고를 때마다 recognizing 을
 * 거치면서 signInput 이 언마운트되므로, 화면 안에 두면 매번 지워진다.
 *
 * V2 시안은 모든 화면에 AppBar 뒤로가기가 있어 역방향 이동은 뒤로가기로 해결한다.
 */
export type WireScreen =
  | { name: 'home' }
  | { name: 'signInput'; phase: SignInputPhase }
  /** 인식 중 화면은 양 트랙 공용 — next 로 트랙을 구분하고 문구 컨텍스트도 여기서 나온다. */
  | { name: 'recognizing'; next: 'candidates' | 'signVideo' }
  | { name: 'result'; sentence: string }
  | { name: 'voiceInput' }
  | { name: 'signVideo' }
  /** __DEV__ 전용: T-03 랜드마크 확인 화면. */
  | { name: 'landmarkDev' };

export function AppNavigator() {
  const [screen, setScreen] = useState<WireScreen>({ name: 'home' });
  const [words, setWords] = useState<readonly MockCandidateWord[]>([]);

  // 첫 화면으로 나가는 건 이 대화를 끝낸다는 뜻이다 — 모은 단어를 다음 대화로 끌고 가지 않는다.
  const goHome = useCallback(() => {
    setWords([]);
    setScreen({ name: 'home' });
  }, []);
  const goSignInput = useCallback(() => setScreen({ name: 'signInput', phase: 'recording' }), []);
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
          phase={screen.phase}
          words={{
            items: words,
            onAdd: (candidate) => {
              setWords((previous) => [...previous, candidate]);
              // 한 단어를 담았으면 곧바로 다음 단어를 찍는 상태로 되돌아간다.
              setScreen({ name: 'signInput', phase: 'recording' });
            },
            onRemove: (index) =>
              setWords((previous) => previous.filter((_, at) => at !== index)),
            onComplete: () =>
              setScreen({ name: 'result', sentence: composeMockSentence(words) }),
          }}
          onStop={() => setScreen({ name: 'recognizing', next: 'candidates' })}
          onRetake={goSignInput}
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
            if (next === 'candidates') setScreen({ name: 'signInput', phase: 'candidates' });
            else setScreen({ name: 'signVideo' });
          }}
          onCancel={next === 'candidates' ? goSignInput : goVoiceInput}
        />
      );
    }
    case 'result':
      return (
        <ResultScreen
          sentence={screen.sentence}
          onGoHome={goHome}
          // 뒤로가기는 단어를 더 붙이거나 빼러 촬영 화면으로 — 모은 단어는 그대로 남아 있다.
          onBack={goSignInput}
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
