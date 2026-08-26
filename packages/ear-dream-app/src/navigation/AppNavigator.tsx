import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../components/Button';
import { LANDMARK_DEV_ENABLED } from '../constants/devFlags';
import { spacing } from '../constants/theme';
import { HomeScreen } from '../features/home/HomeScreen';
import { SplashScreen } from '../features/home/SplashScreen';
import { useVocabulary } from '../features/recognition/api/useVocabulary';
import { LandmarkDevScreen } from '../features/recognition/LandmarkDevScreen';
import { SignFlow } from '../features/recognition/SignFlow';
import { SignVideoScreen } from '../features/voice/SignVideoScreen';
import { VoiceInputScreen } from '../features/voice/VoiceInputScreen';

import { type SlideDirection, TrackTransition } from './TrackTransition';

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
 *   청인→농인: home → voiceInput(음성 인식 또는 키보드) → signVideo
 *     — 입력한 문장은 두 화면을 **실제로 타고 흐른다**(state 에 실린다). 수어 영상 생성만
 *       아직 미구현이라 signVideo 는 문장을 자막으로만 보여준다.
 */
export type WireScreen =
  /** 진입 화면(워드마크) — 시안 `1. 진입 화면`. 탭 또는 자동 전환으로 home 으로 간다. */
  | { name: 'splash' }
  | { name: 'home' }
  /** 농인 트랙 전체 (수어 입력 → 단어 확인 → 문장). */
  | { name: 'signFlow' }
  /**
   * 청인 트랙 "인식 중". 음성 인식은 이 화면에 오기 전에 이미 끝나 있고, 이 체류 시간이
   * 덮는 것은 뒤따르는 수어 영상 생성(미구현)이다 — mock 타이머다(constants/mock.ts).
   */
  | { name: 'voiceInput' }
  | { name: 'signVideo'; text: string }
  /** 개발용: T-03 랜드마크 확인 화면 (노출 조건은 constants/devFlags.ts). */
  | { name: 'landmarkDev' };

export function AppNavigator() {
  const [screen, setScreen] = useState<WireScreen>({ name: 'splash' });
  /** 직전 화면 — 전환 방향을 정하는 데만 쓴다(렌더에 영향이 없어 ref 다). */
  const previousScreenRef = useRef<WireScreen['name'] | null>(null);

  // 서버 카탈로그(/vocabulary + /model)는 부팅 시 1회 로드한다. 실패해도 앱은 뜬다.
  const catalog = useVocabulary();

  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const goSignFlow = useCallback(() => setScreen({ name: 'signFlow' }), []);
  const goVoiceInput = useCallback(() => setScreen({ name: 'voiceInput' }), []);

  const renderScreen = () => {
    switch (screen.name) {
      case 'splash':
        // 진입 화면은 워드마크만 보여주고 곧장 진입 선택으로 넘긴다. 뒤로 돌아오지 않는다 —
        // 시안에도 스플래시로 되돌아가는 경로가 없다.
        return <SplashScreen onContinue={goHome} />;
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
        return <SignFlow catalog={catalog} onReply={goVoiceInput} />;
      case 'voiceInput':
        // 음성 인식 결과와 키보드 입력이 같은 콜백으로 온다 — 다음 화면 입장에서 차이가 없다.
        // **곧바로 재생 화면으로 간다.** 중간에 "인식 중" 화면을 두던 시절이 있었는데,
        // 그건 서버 호출이 시작되기도 전에 흐르는 고정 타이머였다. 실제 대기는
        // SignVideoScreen 이 요청하는 동안이고 그 화면이 자기 로딩 상태를 갖고 있다.
        return (
          <VoiceInputScreen
            onSubmit={(text) => setScreen({ name: 'signVideo', text })}
            onSwitchToSign={goSignFlow}
          />
        );
      case 'signVideo':
        // 답장하기 = 대화 턴을 되돌려 받는다 — 농인 트랙(수어 입력)을 새 세션으로 연다.
        // 답장하기 = 대화 턴을 되돌려 받는다(손 손잡이). 뒤로 = 다시 말하러 음성 입력으로.
        return (
          <SignVideoScreen
            sentence={screen.text}
            onReply={goSignFlow}
            onBack={goVoiceInput}
          />
        );
        case 'landmarkDev':
          return <LandmarkDevWrapper onBack={goHome} />;
    }
  };

  /*
    주도권이 바뀌는 전환은 화면이 밀려 들어온다(2026-08-24 요청).

    방향은 **누른 손잡이가 있던 쪽**에서 나온다 — 청인 화면 아래 손잡이를 누르면 수어
    화면이 아래에서 올라오고, 농인 화면 위 손잡이를 누르면 음성 화면이 위에서 내려온다.
    트랙과 무관한 이동(첫 화면 · 개발 화면 등)은 움직이지 않는다.
  */
  const previous = previousScreenRef.current;
  previousScreenRef.current = screen.name;

  return (
    <TrackTransition screenKey={screen.name} direction={slideDirection(previous, screen.name)}>
      {renderScreen()}
    </TrackTransition>
  );
}

/** 트랙 화면인가 — 슬라이드는 주도권이 오가는 전환에만 준다. */
const SIGN_TRACK: readonly WireScreen['name'][] = ['signFlow'];
const VOICE_TRACK: readonly WireScreen['name'][] = ['voiceInput', 'signVideo'];

function slideDirection(from: WireScreen['name'] | null, to: WireScreen['name']): SlideDirection {
  if (from === null || from === to) return 'none';
  // 청인 → 농인: 아래쪽 손 손잡이에서 올라온다.
  if (VOICE_TRACK.includes(from) && SIGN_TRACK.includes(to)) return 'up';
  // 농인 → 청인: 위쪽 마이크 손잡이에서 내려온다.
  if (SIGN_TRACK.includes(from) && VOICE_TRACK.includes(to)) return 'down';
  return 'none';
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
