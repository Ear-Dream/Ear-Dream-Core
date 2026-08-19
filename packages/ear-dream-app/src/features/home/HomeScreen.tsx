import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Wordmark } from '../../components/Wordmark';
import { strings } from '../../constants/strings';
import { fonts, maxScreenWidth, spacing } from '../../constants/theme';

import { HOME_FALLBACK_COLOR } from './backgroundTint';
import { EntryButton } from './EntryButton';
import { SignTrackIcon, VoiceTrackIcon } from './EntryIcons';
import { HomeBackground } from './HomeBackground';

export interface HomeScreenProps {
  /** 농인 → 청인 트랙 시작 (수어 입력). */
  onStartSign: () => void;
  /** 청인 → 농인 트랙 시작 (음성 입력). */
  onStartVoice: () => void;
  /** 개발 빌드 전용: T-03 랜드마크 확인 화면 진입. 프로덕션에서는 넘기지 않는다. */
  onOpenLandmarkDev?: () => void;
}

/**
 * 첫 화면 (확정 디자인 「1. 첫 화면 — 진입 선택」).
 *
 * 배경 영상 위에 워드마크와 흰 pill 두 개만 얹는다. 다른 화면과 달리 `ScreenFrame` 을
 * 쓰지 않는다 — 이 화면은 AppBar 도 흰 캔버스도 없고 배경이 화면 끝까지 차야 한다.
 * 폭 제한(maxScreenWidth)은 콘텐츠에만 걸고 배경은 전체를 덮는다: 데스크톱 브라우저에서
 * 영상만 가운데 좁게 뜨면 시안의 전면 배경이라는 의도가 사라진다.
 *
 * 워드마크는 텍스트가 아니라 벡터다(`Wordmark` 주석 — 시안 서체가 번들에 없다).
 */
export function HomeScreen({ onStartSign, onStartVoice, onOpenLandmarkDev }: HomeScreenProps) {
  return (
    <View style={styles.root}>
      <HomeBackground />

      <View style={styles.content}>
        <View style={styles.hero} accessibilityLabel={strings.common.logoAlt}>
          <Wordmark size={WORDMARK_WIDTH} testID="home-logo" />
        </View>

        <View style={styles.entries}>
          <EntryButton
            label={strings.home.startSign}
            icon={<SignTrackIcon />}
            onPress={onStartSign}
            testID="home-start-sign"
          />
          <EntryButton
            label={strings.home.startVoice}
            icon={<VoiceTrackIcon />}
            onPress={onStartVoice}
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
        </View>
      </View>
    </View>
  );
}

/** 시안 워드마크 폭(430pt 프레임 기준 140pt). */
const WORDMARK_WIDTH = 140;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // 영상 로드 전 · 재생 실패 시에도 흰 워드마크가 흰 바탕에 묻히지 않게.
    backgroundColor: HOME_FALLBACK_COLOR,
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
  },
  // 시안은 워드마크가 화면 상단 1/3 지점에 있다 — 하단 버튼과의 사이를 비워 두는 구도다.
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entries: {
    gap: spacing.xl,
    paddingBottom: spacing.xxl + spacing.lg,
  },
  devLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  devLinkPressed: {
    opacity: 0.6,
  },
  devLinkText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#ffffff',
  },
});
