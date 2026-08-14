import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Animated, Easing, StyleSheet } from 'react-native';

import { USE_NATIVE_DRIVER } from '../constants/motion';
import { colors } from '../constants/theme';
import { useReducedMotion } from '../hooks/useReducedMotion';

export interface SpinnerRingProps {
  /** 지름(px). 화면마다 역할이 달라(대기 표시 · 버튼 감싸기) 기본값을 두지 않는다. */
  size: number;
  /** 링 두께(px). 지름에 비례하지 않는다 — 큰 링일수록 얇게 그리는 편이 낫다. */
  thickness: number;
  /** 한 바퀴 도는 데 걸리는 시간. 기본 1200ms. */
  periodMs?: number;
  /** 배치용(예: 버튼 뒤 절대 배치). 회전 transform 은 이 style 뒤에 붙어 덮이지 않는다. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * 제자리에서 도는 링 — "기다리는 중"의 공통 표시.
 *
 * 한쪽(위)만 브랜드색으로 칠한 호라서 회전이 눈에 보인다. 테두리를 전부 같은 색으로 칠하면
 * 돌아도 가만히 있는 것과 구분되지 않는다.
 *
 * `Ripple`(바깥으로 퍼지는 물결 = 소리가 나가는 중)과 역할이 다르다. 이 링은 제자리에서
 * 돌기만 하고 커지지 않는다 — 아직 아무것도 나가지 않았고 기다리는 중이라는 뜻이다.
 * 두 표시를 하나로 합치면 "준비 중"과 "재생 중"이 같은 모양이 되어, 사용자는 몇 초를 더
 * 기다려야 하는지 알 수 없게 된다(SpeakerButton 주석 참고).
 *
 * 「동작 줄이기」가 켜져 있으면 **돌리지 않되 링은 그대로 그린다.** 물결(`Ripple`)은 아예
 * 그리지 않는 것과 다른 처리인데, 물결은 옆의 정지 사각형이 같은 사실을 말해 주는 장식이지만
 * 이 링은 그 자리에서 대기 상태를 표시하는 유일한 도형인 경우가 있기 때문이다. 움직임을 뺀
 * 대가로 상태 표시까지 사라지면 안 된다.
 *
 * 색은 props 로 열지 않았다 — 지금 쓰는 두 곳이 같은 브랜드색이고, 색이 갈리기 시작하면
 * "무엇을 기다리는 중인지"가 화면마다 달라 보인다. 필요해지면 그때 연다.
 *
 * 장식이므로 스크린리더에는 노출하지 않고 터치도 가로채지 않는다 — 무엇을 기다리는지는
 * 곁의 문구가 말한다.
 */
export function SpinnerRing({
  size,
  thickness,
  periodMs = SPIN_PERIOD_MS,
  style,
  testID,
}: SpinnerRingProps) {
  const reduceMotion = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;

    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: periodMs,
        // 등속이어야 루프 이음매에서 멈칫하지 않는다.
        easing: Easing.linear,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    );
    loop.start();

    return () => loop.stop();
  }, [periodMs, reduceMotion, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderWidth: thickness },
        style,
        { transform: [{ rotate }] },
      ]}
    />
  );
}

/** 기본 회전 주기. 너무 빠르면 조급해 보이고 느리면 멈춘 것처럼 보이는 선에서 잡은 값이다. */
const SPIN_PERIOD_MS = 1200;

const styles = StyleSheet.create({
  ring: {
    borderColor: colors.brand.subtle,
    borderTopColor: colors.brand.primary,
  },
});
