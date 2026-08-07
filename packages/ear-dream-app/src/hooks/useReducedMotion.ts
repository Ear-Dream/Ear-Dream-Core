import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * OS 의 「동작 줄이기」(iOS Reduce Motion / Android 애니메이션 제거 / 웹
 * `prefers-reduced-motion`) 설정을 구독한다.
 *
 * 이 앱의 장식 애니메이션(파형·로고)은 반복 루프라 켜 두면 계속 움직인다. 전정기관 장애나
 * 광과민성 사용자에게는 이런 지속 루프가 실제로 문제가 되므로, 설정이 켜져 있으면 호출부가
 * 정지 상태로 렌더링한다.
 *
 * 초기값은 `false` 다. 실제 값은 비동기로 들어오므로 첫 프레임은 항상 "움직임 허용"으로
 * 그려진 뒤 필요하면 정지로 바뀐다.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduced(enabled);
      })
      .catch(() => {
        // 조회 실패 시엔 기본값(움직임 허용)을 유지한다.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (alive) setReduced(enabled);
    });

    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}
