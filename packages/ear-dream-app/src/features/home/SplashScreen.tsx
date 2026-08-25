import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Wordmark } from '../../components/Wordmark';
import { strings } from '../../constants/strings';
import { useDesignScale } from '../../hooks/useDesignScale';

import { HOME_FALLBACK_COLOR } from './backgroundTint';
import { HomeBackground } from './HomeBackground';

export interface SplashScreenProps {
  /** 진입 선택 화면으로 넘어간다. */
  onContinue: () => void;
}

/**
 * 진입 화면 (피그마 「최종」 `1. 진입 화면`, 473:1120).
 *
 * 배경 영상 위에 스크림 한 장과 워드마크만 있는 화면이다. 시안이 진입 선택
 * (`2. 첫 화면 — 진입 선택`)과 **별도 프레임으로 나뉘어 있어** 화면도 둘로 나눴다.
 * 배경·스크림은 기존 `HomeBackground` 를 그대로 쓴다 — 시안의 배경 아트워크가 앱에 이미
 * 들어 있는 `home-background.mp4` 와 같은 그림이고, 스크림 값(brand/primary 60%)도 같다.
 *
 * ⚠️ **넘어가는 방식은 시안에 없다.** 시안은 정지 프레임 두 장뿐이라 전환 트리거가 없어서,
 * 자동 전환(`AUTO_ADVANCE_MS`) + 아무 곳이나 탭으로 건너뛰기를 임시로 넣었다. 대기 시간은
 * 근거 없는 값이다 — 실기기에서 "로고를 읽을 수 있는 최소 시간"을 재서 정해야 한다.
 *
 * 세로 위치는 시안 절대좌표(top 301, 워드마크 높이 113, 총 932)를 flex 비율로 옮겼다.
 * 화면 높이가 달라져도 비율이 유지된다. 가로는 시안이 3.5pt 왼쪽으로 치우쳐 있는데
 * 이건 의도로 보기 어려워 가운데 정렬했다.
 */
export function SplashScreen({ onContinue }: SplashScreenProps) {
  // 워드마크는 도형이라 균등 배율로 줄인다(HomeScreen 타일과 같은 이유).
  const { v } = useDesignScale();
  const wordmarkWidth = v(WORDMARK_DESIGN_WIDTH);

  useEffect(() => {
    const timer = setTimeout(onContinue, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [onContinue]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.home.splashContinue}
      onPress={onContinue}
      style={styles.root}
      testID="splash-root"
    >
      <HomeBackground />

      <View style={styles.content} pointerEvents="none">
        <View style={styles.spacerAbove} />
        <View accessibilityLabel={strings.common.logoAlt}>
          <Wordmark size={wordmarkWidth} testID="splash-logo" />
        </View>
        <View style={styles.spacerBelow} />
      </View>
    </Pressable>
  );
}

/** 시안 워드마크 폭(점 포함). */
const WORDMARK_DESIGN_WIDTH = 193;

/** 시안 세로 배치: 위 301 / 워드마크 113 / 아래 518 (총 932). */
const SPACER_ABOVE_FLEX = 301;
const SPACER_BELOW_FLEX = 932 - 301 - 113;

/** ⚠️ 시안 외 임시값 — 근거 없음. 실기기에서 재고 정한다. */
const AUTO_ADVANCE_MS = 1800;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // 영상 로드 전 · 재생 실패 시에도 흰 워드마크가 흰 바탕에 묻히지 않게.
    backgroundColor: HOME_FALLBACK_COLOR,
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  spacerAbove: {
    flex: SPACER_ABOVE_FLEX,
  },
  spacerBelow: {
    flex: SPACER_BELOW_FLEX,
  },
});
