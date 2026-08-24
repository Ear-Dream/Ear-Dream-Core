import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

import { USE_NATIVE_DRIVER } from '../constants/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

/** 새 화면이 어느 쪽에서 밀려 들어오는가. `none` 이면 애니메이션 없이 그대로 그린다. */
export type SlideDirection = 'up' | 'down' | 'none';

export interface TrackTransitionProps {
  /**
   * 화면 식별자. **이 값이 바뀔 때만** 애니메이션이 돈다.
   * 같은 화면 안의 리렌더(상태 변경)로는 다시 밀려 들어오지 않는다.
   */
  screenKey: string;
  direction: SlideDirection;
  children: ReactNode;
}

/**
 * 주도권(트랙)이 바뀔 때 화면이 밀려 들어오는 전환.
 *
 * ## 방향은 손잡이가 정한다
 *
 * 트랙 전환 손잡이(`TrackSwitchHandle`)의 화살촉이 가리키는 방향과 화면이 움직이는 방향을
 * 맞춘다 — 청인 화면 **아래쪽** 손잡이(∧)를 누르면 수어 화면이 **아래에서 위로** 올라오고,
 * 농인 화면 **위쪽** 손잡이(∨)를 누르면 음성 화면이 **위에서 아래로** 내려온다.
 * 누른 곳에서 화면이 나오는 셈이라 "어디를 눌렀더니 무엇이 왔는지"가 몸으로 남는다.
 *
 * ## 들어오는 화면만 움직인다
 *
 * 나가는 화면과 들어오는 화면을 함께 밀어내는(cross-slide) 편이 보기에는 낫지만, 그러려면
 * **두 화면이 잠시 동시에 살아 있어야 한다.** 이 앱에서는 그 사이에 카메라와 마이크가 같이
 * 열리는 순간이 생긴다 — 안드로이드에서 마이크를 두 주체가 잡으면 인식 쪽에 무음이 들어가는
 * 문제가 이미 확인된 바 있다(VoiceInputScreen 주석). 그래서 이전 화면은 즉시 언마운트하고
 * 새 화면만 밀어 넣는다.
 *
 * 「동작 줄이기」가 켜져 있으면 움직이지 않고 바로 자리에 그린다 — 전환은 장식이고, 이 화면
 * 전환에는 움직임 말고 다른 정보가 실려 있지 않다.
 */
export function TrackTransition({ screenKey, direction, children }: TrackTransitionProps) {
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // 0 = 제자리. 1 = 아직 화면 밖.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (direction === 'none' || reduceMotion) {
      progress.setValue(0);
      return;
    }

    progress.setValue(1);
    const animation = Animated.timing(progress, {
      toValue: 0,
      duration: SLIDE_DURATION_MS,
      // 들어와서 멈추는 움직임이라 감속 곡선이다. 등속이면 도착이 뚝 끊긴다.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();

    return () => animation.stop();
    // screenKey 가 의존성에 있어야 **화면이 바뀔 때마다** 다시 돈다.
  }, [screenKey, direction, reduceMotion, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    // up = 아래에서 위로 올라온다(시작점이 화면 아래). down 은 그 반대다.
    outputRange: [0, direction === 'up' ? height : -height],
  });

  return (
    <Animated.View style={[styles.root, { transform: [{ translateY }] }]}>{children}</Animated.View>
  );
}

/**
 * 전환 시간. 시안에 값이 없어 임시로 잡았다 — 화면 한 장이 지나가는 거리치고 짧으면
 * 끊겨 보이고, 길면 대화 흐름이 늘어진다. 실기기에서 재고 정할 값이다.
 */
const SLIDE_DURATION_MS = 260;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
