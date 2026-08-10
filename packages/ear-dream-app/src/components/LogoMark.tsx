import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { USE_NATIVE_DRIVER } from '../constants/motion';
import { colors, radius } from '../constants/theme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Ripple } from './Ripple';

export interface LogoMarkProps {
  /** false 면 애니메이션을 멈추고 정지 상태로 고정한다. 기본 true. */
  animating?: boolean;
  testID?: string;
}

/**
 * 로고(구름+달) — 확정 자산 전 placeholder. 시안의 검은 원 2개 구성을 도형으로 근사한다.
 *
 * 움직임 세 겹:
 * 1. 구름에서 소리처럼 물결이 퍼진다(`Ripple`) — 첫 화면에서 가장 먼저 눈에 걸리는 요소.
 * 2. 구름이 호흡하듯 커졌다 작아지며 살짝 떠오른다.
 * 3. 달이 제자리 공전한다. 위에 있을 때 크고 아래에 있을 때 작아 앞뒤로 도는 것처럼 보인다.
 *
 * 세 주기를 서로 배수가 아니게 잡아서 위상이 계속 어긋난다 — 같은 포즈가 반복되지 않는다.
 *
 * 장식이라 스크린리더에는 노출하지 않는다 — 라벨은 이 컴포넌트를 감싸는 hero 가 갖는다.
 * 실제 로고 자산이 확정되면 도형 대신 이미지로 갈아끼우되 이 움직임은 유지한다.
 */
export function LogoMark({ animating = true, testID }: LogoMarkProps) {
  const reduceMotion = useReducedMotion();
  const breathe = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const active = animating && !reduceMotion;

  useEffect(() => {
    if (!active) {
      // 정지 요청 · 「동작 줄이기」 — 시안 그대로의 정지 포즈(0)로 되돌린다.
      [breathe, orbit].forEach((value) => {
        value.stopAnimation(() => value.setValue(0));
      });
      return;
    }

    const motion = Animated.parallel([
      // 구름: 0 ↔ 1 왕복.
      Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, {
            toValue: 1,
            duration: BREATHE_HALF_CYCLE_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(breathe, {
            toValue: 0,
            duration: BREATHE_HALF_CYCLE_MS,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]),
      ),
      // 달: 0 → 1 을 반복하는 각도. 한 바퀴가 곧 한 주기라 되돌아오지 않고 계속 돈다.
      // 등속(linear)이어야 루프 이음매에서 멈칫하지 않는다.
      Animated.loop(
        Animated.timing(orbit, {
          toValue: 1,
          duration: ORBIT_CYCLE_MS,
          easing: Easing.linear,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ),
    ]);
    motion.start();

    return () => motion.stop();
  }, [active, breathe, orbit]);

  return (
    <View
      style={styles.root}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.cloudSlot}>
        <Ripple
          size={HALO_SIZE}
          startScale={CLOUD_SIZE / HALO_SIZE}
          color={colors.bg.overlay}
          active={active}
        />
        <Animated.View
          style={[
            styles.cloud,
            {
              transform: [
                { translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
                { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] }) },
              ],
            },
          ]}
        />
      </View>

      <Animated.View
        style={[
          styles.moon,
          {
            transform: [
              {
                translateX: orbit.interpolate({
                  inputRange: ORBIT_STEPS,
                  outputRange: ORBIT_STEPS.map((t) => ORBIT_RADIUS * Math.sin(2 * Math.PI * t)),
                }),
              },
              {
                translateY: orbit.interpolate({
                  inputRange: ORBIT_STEPS,
                  outputRange: ORBIT_STEPS.map((t) => -ORBIT_RADIUS * Math.cos(2 * Math.PI * t)),
                }),
              },
              // 위(0·1)에서 크고 아래(0.5)에서 작다 — 앞뒤로 도는 것처럼 보이게 하는 원근 흉내.
              { scale: orbit.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1.12, 0.9, 1.12] }) },
            ],
          },
        ]}
      />
    </View>
  );
}

/**
 * 장식용 값이다. 실제 로고 자산이 확정되기 전 임시 도형에 붙인 움직임이라 별도 근거는 없다 —
 * 눈에 띄되 산만하지 않은 선에서 맞췄다. 세 주기는 서로 배수가 아니어야 위상이 계속 어긋난다
 * (물결 주기는 Ripple 안에 있다).
 */
const BREATHE_HALF_CYCLE_MS = 1450;
const ORBIT_CYCLE_MS = 5200;
const ORBIT_RADIUS = 9;

/**
 * 공전 궤도를 그리는 보간 구간. interpolate 는 구간 사이를 직선으로 잇기 때문에 점이 적으면
 * 원이 아니라 다각형이 된다. 8등분이면 눈으로는 원으로 보인다.
 */
const ORBIT_STEPS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

const CLOUD_SIZE = 80;
const MOON_SIZE = 34;
/** 물결이 가장 멀리 퍼졌을 때의 지름. 구름 지름의 1.5배 남짓. */
const HALO_SIZE = 118;

const styles = StyleSheet.create({
  root: {
    width: 104,
    height: 96,
  },
  cloudSlot: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: CLOUD_SIZE,
    height: CLOUD_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloud: {
    width: CLOUD_SIZE,
    height: CLOUD_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.overlay,
  },
  moon: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: MOON_SIZE,
    height: MOON_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.overlay,
  },
});
