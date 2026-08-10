import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { USE_NATIVE_DRIVER } from '../constants/motion';
import { colors } from '../constants/theme';
import { useReducedMotion } from '../hooks/useReducedMotion';

export interface RippleProps {
  /** 가장 바깥까지 퍼졌을 때의 지름(px). 부모보다 커도 된다 — 넘쳐서 그려진다. */
  size: number;
  /** 퍼지기 시작하는 지점. 가운데 놓인 요소의 지름 ÷ size 로 주면 그 가장자리에서 태어난다. */
  startScale?: number;
  /** 물결 색. 기본 brand/primary. */
  color?: string;
  /** false 면 물결이 사라진다. 기본 true. */
  active?: boolean;
  testID?: string;
}

/**
 * 물에 돌을 떨어뜨렸을 때처럼 가운데에서 바깥으로 퍼지는 동심원.
 *
 * 부모를 가득 채우는 절대 배치라 부모 한가운데를 중심으로 퍼진다. 쓰는 쪽은 물결의 중심이
 * 될 요소를 감싸는 컨테이너 안에 이 컴포넌트를 함께 넣기만 하면 된다.
 *
 * 링 여러 개가 같은 루프를 주기의 1/n 씩 어긋나 돌아서 끊이지 않고 이어진다. 감속 이징
 * (`Easing.out`)을 쓰는 이유는 실제 물결이 퍼질수록 느려지기 때문이다 — 등속이면 레이더처럼
 * 보인다.
 *
 * 장식이므로 스크린리더에는 노출하지 않고 터치도 가로채지 않는다.
 * 「동작 줄이기」가 켜져 있으면 그리지 않는다.
 */
export function Ripple({
  size,
  startScale = 0.4,
  color = colors.brand.primary,
  active = true,
  testID,
}: RippleProps) {
  const reduceMotion = useReducedMotion();

  // useRef(초기값) 은 렌더마다 초기값 식을 평가하므로 최초 1회만 만들도록 지연 생성한다.
  const ringsRef = useRef<Animated.Value[] | null>(null);
  if (ringsRef.current === null) {
    ringsRef.current = Array.from({ length: RING_COUNT }, () => new Animated.Value(0));
  }
  const rings = ringsRef.current;

  const running = active && !reduceMotion;

  useEffect(() => {
    if (!running) {
      // 진행도 0 = 태어나기 직전(불투명도 0) — 멈추면 자연스럽게 사라진 상태가 된다.
      rings.forEach((ring) => {
        ring.stopAnimation(() => ring.setValue(0));
      });
      return;
    }

    const loops = rings.map((ring) =>
      Animated.loop(
        Animated.timing(ring, {
          toValue: 1,
          duration: PERIOD_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ),
    );

    // stagger 는 각 루프 앞에 delay 를 한 번만 끼워 시작 위상을 어긋나게 한다
    // (loop 안에 delay 를 넣으면 매 주기마다 멈칫거린다).
    const wave = Animated.stagger(PERIOD_MS / RING_COUNT, loops);
    wave.start();

    return () => wave.stop();
  }, [running, rings]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.center]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {rings.map((ring, index) => (
        <Animated.View
          key={index}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              // 태어날 때 잠깐 짙어졌다가 퍼지면서 사라진다.
              opacity: ring.interpolate({
                inputRange: [0, FADE_IN_AT, 1],
                outputRange: [0, PEAK_OPACITY, 0],
              }),
              transform: [
                { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [startScale, 1] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

/** 장식용 값이다. 물결이 끊기지 않고 이어져 보이는 정도로만 맞췄다. */
const RING_COUNT = 3;
const PERIOD_MS = 2800;
const PEAK_OPACITY = 0.45;
/** 이 진행도에서 최대 불투명도에 닿는다. 0 에 가까울수록 툭 튀어나오듯 시작한다. */
const FADE_IN_AT = 0.12;

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
});
