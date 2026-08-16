import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../components/Button';
import { LANDMARK_DEV_ENABLED } from '../constants/devFlags';
import { spacing } from '../constants/theme';
import { HomeScreen } from '../features/home/HomeScreen';
import { useVocabulary } from '../features/recognition/api/useVocabulary';
import { LandmarkDevScreen } from '../features/recognition/LandmarkDevScreen';
import { RecognizingScreen } from '../features/recognition/RecognizingScreen';
import { SignFlow } from '../features/recognition/SignFlow';
import { SignVideoScreen } from '../features/voice/SignVideoScreen';
import { VoiceInputScreen } from '../features/voice/VoiceInputScreen';

/**
 * 화면 전환 — 단순 state 기반.
 *
 * 화면이 늘거나 딥링크/히스토리가 필요해지면 expo-router 도입을 팀과 결정한다(스킬 문서 방침).
 * 그때 갈아끼우기 쉽게 화면 컴포넌트는 네비게이션 구현을 모르고 콜백 props 만 받는다.
 *
 * 흐름 (방향 전환 반영):
 *   농인→청인: home → signFlow(단어 기록 → 단어 확인 → 누적 → 문장) → home
 *              또는 결과 화면의 "답장하기" → voiceInput (대화 턴을 상대에게 넘긴다)
 *     — 농인 트랙 내부 전환(입력/후보/결과)은 SignFlow 가 소유한다. 누적 칩과 세션이
 *       화면 전환을 넘어 유지되어야 해서다. 마스터의 signInput/result 라우트(mock 흐름)는
 *       SignFlow 가 대체한다.
 *   청인→농인: home → voiceInput(듣는 중 또는 키보드) → recognizing(mock) → signVideo
 */
export type WireScreen =
  | { name: 'home' }
  /** 농인 트랙 전체 (수어 입력 → 단어 확인 → 문장). */
  | { name: 'signFlow' }
  /** 청인 트랙 전용 "음성 인식 중" (STT 미구현 — mock 타이머). */
  | { name: 'recognizing' }
  | { name: 'voiceInput' }
  | { name: 'signVideo' }
  /** __DEV__ 전용: T-03 랜드마크 확인 화면. */
  | { name: 'landmarkDev' };

export function AppNavigator() {
  const [screen, setScreen] = useState<WireScreen>({ name: 'home' });

  // 서버 카탈로그(/vocabulary + /model)는 부팅 시 1회 로드한다. 실패해도 앱은 뜬다.
  const catalog = useVocabulary();

  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const goSignFlow = useCallback(() => setScreen({ name: 'signFlow' }), []);
  const goVoiceInput = useCallback(() => setScreen({ name: 'voiceInput' }), []);

  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          onStartSign={goSignFlow}
          onStartVoice={goVoiceInput}
          // 프로덕션 웹 빌드(실기기 모바일)에서도 열 수 있다 — 실기기 FPS 실측 때문이다.
          // 근거는 constants/devFlags.ts 참고.
          onOpenLandmarkDev={
            LANDMARK_DEV_ENABLED ? () => setScreen({ name: 'landmarkDev' }) : undefined
          }
        />
      );
    case 'signFlow':
      // onReply: 결과 화면의 "답장하기" — 청인 트랙으로 넘어간다. SignFlow 가 언마운트되며
      // 농인 트랙 세션(pill 큐)은 비워진다(SignFlow.onReply 주석 참고).
      return <SignFlow catalog={catalog} onExit={goHome} onReply={goVoiceInput} />;
    case 'recognizing':
      return (
        <RecognizingScreen
          context="voice"
          onDone={() => setScreen({ name: 'signVideo' })}
          onCancel={goVoiceInput}
        />
      );
    case 'voiceInput':
      return (
        <VoiceInputScreen
          onStopListening={() => setScreen({ name: 'recognizing' })}
          // 입력 텍스트는 STT 미구현이라 다음 화면에서 아직 소비하지 않는다(mock).
          onTextSubmit={() => setScreen({ name: 'recognizing' })}
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
