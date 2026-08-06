import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { WireButton } from '../components/WireButton';
import { strings } from '../constants/strings';
import { spacing } from '../constants/theme';
import { SentenceComposerScreen } from '../features/composer/SentenceComposerScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { CandidateScreen } from '../features/recognition/CandidateScreen';
import { LandmarkDevScreen } from '../features/recognition/LandmarkDevScreen';
import { RecognizingScreen } from '../features/recognition/RecognizingScreen';
import { SignInputScreen } from '../features/recognition/SignInputScreen';
import { ResultScreen } from '../features/transcript/ResultScreen';
import { SignVideoScreen } from '../features/voice/SignVideoScreen';
import { VoiceInputScreen } from '../features/voice/VoiceInputScreen';

/**
 * 와이어프레임 단계 화면 전환 — 단순 state 기반.
 *
 * 화면이 늘거나 딥링크/히스토리가 필요해지면 expo-router 도입을 팀과 결정한다(스킬 문서 방침).
 * 그때 갈아끼우기 쉽게 화면 컴포넌트는 네비게이션 구현을 모르고 콜백 props 만 받는다.
 *
 * 흐름 (피그마 UX):
 *   농인→청인: home → signInput → recognizing → candidates → result
 *              (candidates 에서 정정: 다시 입력 → signInput / 직접 입력 → result)
 *   청인→농인: home → voiceInput → recognizing → signVideo 또는 composer
 *
 * ⚠️ mock 분기: 청인 트랙에서 "정해진 영상 vs 자유 발화"의 실제 분기 조건(정해진 문장 매칭 여부)은
 * 인식이 미구현이라 판단할 수 없다. 와이어프레임에서는 두 갈래를 모두 밟아볼 수 있도록
 * 마이크 탭 → signVideo, 텍스트 입력 제출 → composer 로 임시 연결해 두었다.
 */
export type WireScreen =
  | { name: 'home' }
  | { name: 'signInput' }
  /** 인식 중 화면은 양 트랙 공용. 끝나면 next 로 간다(위 mock 분기 참고). */
  | { name: 'recognizing'; next: 'candidates' | 'signVideo' | 'composer' }
  | { name: 'candidates' }
  | { name: 'result'; sentence: string }
  | { name: 'voiceInput' }
  | { name: 'signVideo' }
  | { name: 'composer' }
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
          onStartTranslate={() => setScreen({ name: 'recognizing', next: 'candidates' })}
          onGoHome={goHome}
        />
      );
    case 'recognizing': {
      const next = screen.next;
      // union 분배 문제로 { name: next } 는 좁혀지지 않아 케이스별로 나눈다.
      return (
        <RecognizingScreen
          onDone={() => {
            if (next === 'candidates') setScreen({ name: 'candidates' });
            else if (next === 'signVideo') setScreen({ name: 'signVideo' });
            else setScreen({ name: 'composer' });
          }}
        />
      );
    }
    case 'candidates':
      return (
        <CandidateScreen
          onConfirm={(sentence) => setScreen({ name: 'result', sentence })}
          onRetry={goSignInput}
          onGoHome={goHome}
        />
      );
    case 'result':
      return <ResultScreen sentence={screen.sentence} onRestart={goSignInput} onGoHome={goHome} />;
    case 'voiceInput':
      return (
        <VoiceInputScreen
          onMicPress={() => setScreen({ name: 'recognizing', next: 'signVideo' })}
          // 입력 텍스트는 아직 다음 화면에서 소비하지 않는다(자유 발화 화면이 목업이라서).
          onTextSubmit={() => setScreen({ name: 'recognizing', next: 'composer' })}
          onGoHome={goHome}
        />
      );
    case 'signVideo':
      return <SignVideoScreen onSpeakAgain={goVoiceInput} onGoHome={goHome} />;
    case 'composer':
      return <SentenceComposerScreen onGoHome={goHome} />;
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
        <WireButton
          label={strings.common.backToHome}
          variant="ghost"
          onPress={onBack}
          testID="landmark-dev-back"
        />
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
