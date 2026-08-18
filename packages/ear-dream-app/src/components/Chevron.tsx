import { StyleSheet, View } from 'react-native';

import { colors } from '../constants/theme';

export interface ChevronProps {
  direction: 'left' | 'right';
  size?: number;
  color?: string;
}

/**
 * V 자 화살표(＜ / ＞). 확정 아이콘 애셋이 없어 View 테두리로 그린다 — 텍스트 글리프보다
 * 플랫폼 간 렌더링이 일정하다. AppBar 뒤로가기와 CandidateRow 우측 표시가 쓴다.
 */
export function Chevron({ direction, size = 12, color = colors.text.primary }: ChevronProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderColor: color,
          transform: [{ rotate: direction === 'left' ? '45deg' : '-135deg' }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderLeftWidth: 2,
    borderBottomWidth: 2,
  },
});
