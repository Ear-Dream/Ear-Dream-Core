import { Pressable, StyleSheet } from 'react-native';

import { strings } from '../constants/strings';
import { spacing, touchTarget } from '../constants/theme';
import { HomeIcon } from './icons/HomeIcon';

export interface HomeActionProps {
  onPress: () => void;
  testID?: string;
}

/**
 * AppBar 우측 홈 버튼 (확정 디자인 — 두 결과 화면). 세션을 끝내고 첫 화면으로 돌아간다.
 *
 * 하단이 아니라 상단에 있는 이유는 AppBar 뒤로가기와 같다 — 흐름을 진행시키는 조작
 * (확정·정정·다음)이 아니라 **이탈 경로**라서 엄지 범위 규칙의 예외로 둔다.
 */
export function HomeAction({ onPress, testID }: HomeActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.common.goHome}
      onPress={onPress}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
      testID={testID}
    >
      <HomeIcon size={HOME_ICON_WIDTH} />
    </Pressable>
  );
}

/** 확정 디자인 실측 44pt(430pt 폭 기준)를 좁은 화면에 맞춰 줄인 값. */
const HOME_ICON_WIDTH = 38;

const styles = StyleSheet.create({
  root: {
    // 시안의 뒤로가기와 같은 48pt 히트 영역.
    width: touchTarget.minHeight,
    height: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.5,
  },
});
