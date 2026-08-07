import { useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';

/** 파형 막대 개수. 레벨을 공급하는 쪽(`useMicLevels`)이 같은 개수로 나눠야 한다. */
export const WAVEFORM_BAR_COUNT = 17;

export interface WaveformProps {
  /**
   * 막대별 진폭(0 = 무음, 1 = 최대). 길이는 `WAVEFORM_BAR_COUNT` 여야 한다.
   * 넘기지 않으면 무음으로 고정되어 가운데 일자선만 보인다 — 아직 소리원이 없는 화면용.
   *
   * `Animated.Value` 를 그대로 받는 이유: 오디오는 매 프레임 갱신되는데 이걸 state 로 올리면
   * 초당 60번 리렌더가 난다. 값만 직접 밀어 넣고 React 는 관여하지 않는다.
   */
  amplitudes?: Animated.Value[];
  /** 막대 색을 덮어쓸 때. 기본 brand/primary. */
  activeColor?: string;
  testID?: string;
}

/**
 * 오디오 레벨 파형 (V2 시안: 음성 입력 · 음성 전달).
 *
 * 소리가 없으면 모든 막대가 가운데 기준선 두께까지 눕는다 — 일자선. 소리가 들어오면 그 구간의
 * 진폭만큼 위아래로 벌어진다. 막대는 중심을 기준으로 `scaleY` 하므로 실제 파형처럼 위아래
 * 대칭으로 자란다.
 *
 * `height` 가 아니라 `scaleY` 를 쓰는 건 매 프레임 레이아웃을 다시 잡지 않기 위해서다.
 *
 * 시안은 왼쪽 2/3 만 인디고인 정적 mock 이었지만, 그건 "소리가 나는 중"을 그림으로 흉내 낸
 * 것이라 실제 레벨이 붙은 지금은 의미가 없다. 막대 색은 전부 활성색으로 통일했다.
 */
export function Waveform({
  amplitudes,
  activeColor = colors.brand.primary,
  testID,
}: WaveformProps) {
  // 소리원이 없는 화면(예: TTS 미구현인 음성 전달)에서 쓰는 무음 값.
  // useRef(초기값) 은 렌더마다 초기값 식을 평가하므로 최초 1회만 만들도록 지연 생성한다.
  const silentRef = useRef<Animated.Value[] | null>(null);
  if (silentRef.current === null) {
    silentRef.current = Array.from({ length: WAVEFORM_BAR_COUNT }, () => new Animated.Value(0));
  }

  const values = amplitudes?.length === WAVEFORM_BAR_COUNT ? amplitudes : silentRef.current;

  const scales = useMemo(
    () =>
      values.map((value) =>
        value.interpolate({
          inputRange: [0, 1],
          outputRange: [FLAT_SCALE, 1],
          extrapolate: 'clamp',
        }),
      ),
    [values],
  );

  return (
    <View
      style={styles.root}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 무음일 때 막대들이 묻혀서 하나의 일자선으로 보이게 하는 기준선. */}
      <View style={styles.baseline} />
      {scales.map((scaleY, index) => (
        <Animated.View
          key={index}
          style={[styles.bar, { backgroundColor: activeColor, transform: [{ scaleY }] }]}
        />
      ))}
    </View>
  );
}

const MAX_BAR_HEIGHT = 34;
const BAR_WIDTH = 4;
/** 무음일 때의 막대 두께. 기준선과 같은 굵기라 서로 이어져 일자선으로 읽힌다. */
const BASELINE_HEIGHT = 2;
const FLAT_SCALE = BASELINE_HEIGHT / MAX_BAR_HEIGHT;

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: MAX_BAR_HEIGHT,
  },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BASELINE_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: colors.border.default,
  },
  bar: {
    width: BAR_WIDTH,
    height: MAX_BAR_HEIGHT,
    borderRadius: radius.pill,
  },
});
