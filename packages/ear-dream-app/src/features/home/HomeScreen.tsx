import { StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { strings } from '../../constants/strings';
import { colors, spacing } from '../../constants/theme';

export interface HomeScreenProps {
  /** 농인 → 청인 트랙 시작 (수어 입력). */
  onStartSign: () => void;
  /** 청인 → 농인 트랙 시작 (음성 입력). */
  onStartVoice: () => void;
  /** 개발 빌드 전용: T-03 랜드마크 확인 화면 진입. 프로덕션에서는 넘기지 않는다. */
  onOpenLandmarkDev?: () => void;
}

/** 첫 화면(방향 선택). 중앙 로고 + 하단 트랙 선택 버튼. */
export function HomeScreen({ onStartSign, onStartVoice, onOpenLandmarkDev }: HomeScreenProps) {
  return (
    <ScreenFrame
      showHeader={false}
      footer={
        <>
          <WireButton
            label={strings.home.startSign}
            onPress={onStartSign}
            testID="home-start-sign"
          />
          <WireButton
            label={strings.home.startVoice}
            onPress={onStartVoice}
            testID="home-start-voice"
          />
          {/* 체험 시작의 동작은 미정이다(피그마에도 연한 스타일로만 존재). placeholder 로 비활성. */}
          <WireButton
            label={strings.home.startTrial}
            variant="ghost"
            disabled
            testID="home-start-trial"
          />
          {onOpenLandmarkDev ? (
            <WireButton
              label={strings.home.landmarkDev}
              onPress={onOpenLandmarkDev}
              variant="ghost"
              testID="home-landmark-dev"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.hero} accessibilityLabel={strings.common.logoAlt}>
        <Text style={styles.logoGlyph}>{strings.common.logoGlyph}</Text>
        <Text style={styles.appName}>{strings.common.appName}</Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  logoGlyph: {
    fontSize: 56,
    color: colors.textPrimary,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
