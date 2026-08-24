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
/**
 * iconKey → 컴포넌트.
 *
 * `subway` 는 그림만 있고 쓰이지 않는다 — 서빙 어휘에 「지하철」이 없다(아래 표 주석).
 * 어휘에 들어오면 표에 한 줄만 더하면 된다.
 */
export const CANDIDATE_ICONS: Record<string, ComponentType<IconProps>> = {
  car: Car,
  bus: Bus,
  train: Train,
  subway: Subway,
};

/**
 * 어휘 라벨 → 아이콘 키.
 *
 * ## 두 번 어긋나 있었다
 *
 * 1. 이 표가 없던 동안 위 픽토그램은 **어디에서도 쓰이지 않았다** — `iconKey` 를 넘겨주는
 *    호출부가 하나도 없었다.
 * 2. 표를 처음 만들 때 시안 예시(자동차·버스·지하철)를 그대로 옮겼는데, **그 셋은 서빙
 *    어휘 300단어에 없다**(2026-08-24 `/vocabulary` 실측). 실제로 있는 말은 `자가용`·
 *    `마을버스`·`기차`다. 시안은 그림을 그리기 좋은 일반명사를 예시로 쓴 것이고 모델
 *    어휘와 맞춘 것이 아니다.
 *
 * ⚠️ 그래서 **그림이 붙는 단어는 지금 셋뿐이다.** 나머지 297개는 글자만 나오는 것이
 * 정상이다 — 「가다」·「싫다」 같은 추상어는 픽토그램이 성립하지 않는다(위 주석 참고).
 * 어휘에 있는 나머지 교통어(`구급차`·`여객선`·`차도`·`기차역`·`터미널`·`주차장`)는
 * 대응하는 그림이 아직 없다. 그림을 늘리려면 위 컴포넌트와 이 표에 **함께** 추가한다.
 *
 * 새 라벨을 넣기 전에 반드시 `/vocabulary` 로 실재 여부를 확인할 것 — 없는 라벨을 적으면
 * 조용히 아무 일도 일어나지 않는다.
 */
const LABEL_TO_ICON: Record<string, string> = {
  자가용: 'car',
  마을버스: 'bus',
  기차: 'train',
};

/** 라벨에 해당하는 픽토그램. 없으면 undefined — 호출부는 글자만 그린다. */
export function candidateIconFor(label: string): ComponentType<IconProps> | undefined {
  const key = LABEL_TO_ICON[label];
  return key ? CANDIDATE_ICONS[key] : undefined;
}