/**
 * 마이크 레벨 훅 — 네이티브(기본) 구현.
 *
 * 웹에서는 번들러가 useMicLevels.web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 *
 * 네이티브에는 아직 오디오 캡처 수단이 없다. `expo-audio` 는 설치되어 있지 않고, 파형 표시만을
 * 위해 의존성을 늘리는 건 지금 단계에서 이르다(STT 자체가 미구현이라 어차피 같이 붙게 된다).
 * 그래서 여기서는 무음을 돌려주고 화면은 일자선을 그린다 — 알려진 정상 상태다.
 *
 * 나중에 네이티브를 지원할 때 바꿀 곳은 이 파일 하나다. types.ts 의 UseMicLevelsResult 만
 * 맞춰 구현하면 화면 코드는 그대로 쓴다.
 */
import { useRef } from 'react';
import { Animated } from 'react-native';

import type { UseMicLevelsResult } from './types';

export function useMicLevels(_active: boolean, barCount: number): UseMicLevelsResult {
  const amplitudes = useSilentAmplitudes(barCount);

  return {
    amplitudes,
    status: 'unsupported',
    error: '마이크 파형은 현재 웹에서만 동작합니다.',
  };
}

/** barCount 개의 0 값 배열을 훅 수명 동안 유지한다. */
function useSilentAmplitudes(barCount: number): Animated.Value[] {
  const ref = useRef<Animated.Value[] | null>(null);
  if (ref.current === null || ref.current.length !== barCount) {
    ref.current = Array.from({ length: barCount }, () => new Animated.Value(0));
  }
  return ref.current;
}
