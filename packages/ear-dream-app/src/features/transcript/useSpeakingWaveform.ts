import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

import { WAVEFORM_BAR_COUNT } from '../../components/Waveform';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * 음성 전달 화면의 파형 값 — **장식이다. 실제 오디오 레벨이 아니다.**
 *
 * 확정 디자인의 음성 전달 카드에는 스피커 아래 파형이 있고, 시안의 그 파형도 정적
 * mock(왼쪽은 진하고 오른쪽은 흐린 고정 모양)이다. 문제는 재생 쪽에 레벨 소스가 없다는
 * 것이다 — 서버 TTS 는 WAV 를 통째로 돌려주고 브라우저 SpeechSynthesis 는 진폭을 아예
 * 노출하지 않는다. 그래서 "지금 나가는 소리의 파형"은 만들 수가 없다.
 *
 * 그럼에도 그리는 이유와 지키는 선:
 *   · **모양**은 시안 고정 프로필을 그대로 쓴다 — 소리를 측정한 척하지 않는다.
 *   · **움직임**은 재생 중(`speaking`)에만 준다. 멈춰 있으면 소리도 멈춘 것이다.
 *     즉 움직임 자체는 거짓이 아니다(무엇을 말하는지가 아니라 말하는 중임을 뜻한다).
 *   · 레벨 소스가 생기면 이 훅을 지우고 `useMicLevels` 처럼 실측값을 꽂으면 된다.
 *
 * 「동작 줄이기」면 고정 프로필에서 멈춘다 — 반복 루프라 그대로 두면 계속 움직인다.
 */
export function useSpeakingWaveform(speaking: boolean): Animated.Value[] {
  const reducedMotion = useReducedMotion();

  const valuesRef = useRef<Animated.Value[] | null>(null);
  if (valuesRef.current === null) {
    valuesRef.current = STATIC_PROFILE.map((level) => new Animated.Value(level));
  }
  const values = valuesRef.current;

  useEffect(() => {
    if (!speaking || reducedMotion) {
      // 고정 프로필로 되돌린다 — 재생이 끝나면 시안의 정지 모양이 남는다.
      const settle = Animated.parallel(
        values.map((value, index) =>
          Animated.timing(value, {
            toValue: STATIC_PROFILE[index],
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      );
      settle.start();
      return () => settle.stop();
    }

    // 막대마다 위상을 어긋나게 해 한 덩어리로 뛰지 않게 한다.
    const loop = Animated.loop(
      Animated.stagger(
        BAR_STAGGER_MS,
        values.map((value, index) =>
          Animated.sequence([
            Animated.timing(value, {
              toValue: PEAK_PROFILE[index],
              duration: BAR_RISE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: STATIC_PROFILE[index],
              duration: BAR_RISE_MS,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [speaking, reducedMotion, values]);

  return values;
}

/**
 * 시안의 고정 파형 프로필 — 피그마 「최종」 파형(460:2243)의 막대 높이 실측을
 * 최대값 93 으로 나눈 값이다. 눈대중 근사가 아니라 시안 수치 그대로다.
 * 원본 높이: 15 30 51 72 93 72 42 66 93 54 30 45 75 36 18
 */
const STATIC_PROFILE = [
  15 / 93, 30 / 93, 51 / 93, 72 / 93, 1, 72 / 93, 42 / 93, 66 / 93, 1, 54 / 93, 30 / 93, 45 / 93,
  75 / 93, 36 / 93, 18 / 93,
];

/** 재생 중 각 막대가 오르내리는 상단값. 프로필 형태는 유지한 채 진폭만 키운다. */
const PEAK_PROFILE = STATIC_PROFILE.map((level) => Math.min(1, level * 1.45 + 0.1));

const BAR_RISE_MS = 320;
const BAR_STAGGER_MS = 40;

/** 프로필 길이는 파형 막대 개수와 같아야 한다 — 다르면 Waveform 이 무음 값으로 떨어진다. */
if (STATIC_PROFILE.length !== WAVEFORM_BAR_COUNT) {
  throw new Error(
    `파형 프로필 길이(${STATIC_PROFILE.length})가 막대 개수(${WAVEFORM_BAR_COUNT})와 다릅니다.`,
  );
}
