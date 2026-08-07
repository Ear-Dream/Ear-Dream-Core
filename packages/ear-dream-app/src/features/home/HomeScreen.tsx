import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { LogoMark } from '../../components/LogoMark';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';

export interface HomeScreenProps {
  /** 농인 → 청인 트랙 시작 (수어 입력). */
  onStartSign: () => void;
  /** 청인 → 농인 트랙 시작 (음성 입력). */
  onStartVoice: () => void;
  /** 개발 빌드 전용: T-03 랜드마크 확인 화면 진입. 프로덕션에서는 넘기지 않는다. */
  onOpenLandmarkDev?: () => void;
}

/**
 * 첫 화면 (V2 청인 섹션 버전, 사용자 확정): 로고 + "손으로 말하기"(primary) /
 * "입으로 말하기"(outline) 2버튼. 부제 없음.
 */
export function HomeScreen({ onStartSign, onStartVoice, onOpenLandmarkDev }: HomeScreenProps) {
  return (
    <ScreenFrame
      footer={
        <>
          <Button
            label={strings.home.startSign}
            onPress={onStartSign}
            icon={<SignTrackIcon />}
            testID="home-start-sign"
          />
          <Button
            label={strings.home.startVoice}
            variant="outline"
            onPress={onStartVoice}
            icon={<VoiceTrackIcon />}
            testID="home-start-voice"
          />
          {onOpenLandmarkDev ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.home.landmarkDev}
              onPress={onOpenLandmarkDev}
              style={({ pressed }) => [styles.devLink, pressed && styles.devLinkPressed]}
              testID="home-landmark-dev"
            >
              <Text style={styles.devLinkText}>{strings.home.landmarkDev}</Text>
            </Pressable>
          ) : null}
        </>
      }
    >
      <View style={styles.hero} accessibilityLabel={strings.common.logoAlt}>
        <LogoMark testID="home-logo" />
        <Text style={styles.appName}>{strings.common.appName}</Text>
      </View>
    </ScreenFrame>
  );
}

/** "손으로 말하기" 좌측 아이콘 자리 — 확정 자산 전 placeholder 도형(시안: 흰 라운드 사각). */
function SignTrackIcon() {
  return <View style={styles.signIcon} />;
}

/** "입으로 말하기" 좌측 아이콘 자리 — 확정 자산 전 placeholder 도형(시안: 인디고 원). */
function VoiceTrackIcon() {
  return (
    <View style={styles.voiceIconRing}>
      <View style={styles.voiceIconDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  appName: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.text.primary,
    textAlign: 'center',
  },
  signIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: colors.text.onBrand,
  },
  voiceIconRing: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.subtle,
  },
  voiceIconDot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
  },
  devLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  devLinkPressed: {
    opacity: 0.6,
  },
  devLinkText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
  },
});
