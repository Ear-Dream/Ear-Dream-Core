import type { ComponentType } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color: string };

/**
 * 후보 픽토그램. 채우기 대신 선으로 그린다 —
 * 선택 시 카드 배경이 바뀌어도 아이콘 안쪽을 배경색으로 메울 필요가 없다.
 */
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
});

function Car({ size = 28, color }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M4 14 L5.5 9.5 A2 2 0 0 1 7.4 8 H14 A2 2 0 0 1 15.5 8.7 L18.5 12 L20 12.5 A1.5 1.5 0 0 1 21 14 V16 H3 V15.5 A1.5 1.5 0 0 1 4 14 Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx="7.5" cy="16.6" r="1.8" stroke={color} strokeWidth={1.7} />
      <Circle cx="16.5" cy="16.6" r="1.8" stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function Bus({ size = 28, color }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x="4" y="3.5" width="16" height="13" rx="2.2" stroke={color} strokeWidth={1.7} />
      <Path d="M4 9 H20 M12 3.5 V9" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx="8" cy="18.2" r="1.6" stroke={color} strokeWidth={1.7} />
      <Circle cx="16" cy="18.2" r="1.6" stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function Train({ size = 28, color }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Rect x="5" y="3" width="14" height="12" rx="2.5" stroke={color} strokeWidth={1.7} />
      <Path d="M5 8.6 H19" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx="9.2" cy="11.9" r="1.1" stroke={color} strokeWidth={1.5} />
      <Circle cx="14.8" cy="11.9" r="1.1" stroke={color} strokeWidth={1.5} />
      <Path
        d="M8.5 15 L6.5 18.6 M15.5 15 L17.5 18.6 M4.5 20.5 H19.5"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function Subway({ size = 28, color }: IconProps) {
  return (
    <Svg {...base(size)}>
      <Path
        d="M3 20.5 V11.5 A9 9 0 0 1 21 11.5 V20.5"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Rect x="7.5" y="8" width="9" height="10" rx="2" stroke={color} strokeWidth={1.7} />
      <Path d="M7.5 12.6 H16.5" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/**
 * iconKey → 컴포넌트. 여기 없는 키는 아이콘 없이 글자만 나온다.
 * '가다', '싫다' 같은 추상어는 픽토그램이 성립하지 않으므로 iconKey를 비워 둔다.
 */
export const CANDIDATE_ICONS: Record<string, ComponentType<IconProps>> = {
  car: Car,
  bus: Bus,
  train: Train,
  subway: Subway,
};