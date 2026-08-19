import Svg, { Path } from 'react-native-svg';

import { colors } from '../../constants/theme';

export interface HomeIconProps {
  /** 렌더 폭(pt). 높이는 원본 비율(44:38)로 따라간다. */
  size?: number;
  color?: string;
}

/**
 * 집 아이콘 — 확정 디자인의 `home_fill` 벡터를 그대로 내보낸 것(원본 44×38).
 *
 * 두 결과 화면(음성 전달 · 수어로 보기) AppBar 우측의 "처음으로" 자리다. 하단을 primary
 * 버튼 하나로 비워 두려면(시안 Button 규칙 「Primary 는 화면당 1개」) 세션을 끝내는
 * 이탈 경로가 상단으로 올라와야 한다.
 *
 * 자형을 바꾸려면 여기서 손보지 말고 피그마에서 다시 내보낸다.
 */
export function HomeIcon({ size = SOURCE_WIDTH, color = colors.text.primary }: HomeIconProps) {
  return (
    <Svg
      width={size}
      height={(size * SOURCE_HEIGHT) / SOURCE_WIDTH}
      viewBox={`0 0 ${SOURCE_WIDTH} ${SOURCE_HEIGHT}`}
      fill="none"
    >
      <Path fillRule="evenodd" clipRule="evenodd" d="M23.1884 0.410172C22.4972 -0.136732 21.5021 -0.136723 20.8109 0.410192L0.686294 16.334C0.0737168 16.8187 -0.157136 17.6227 0.109551 18.3425C0.376237 19.0624 1.08292 19.5429 1.87506 19.5429H4.78947L6.27954 35.2589C6.42675 36.8116 7.77596 38 9.39148 38H16.3754C17.0657 38 17.6254 37.4599 17.6254 36.7937V27.5232C17.6254 23.9041 20.6849 23.9041 21.3753 23.9041H22.6253C23.3156 23.9041 26.3752 23.9041 26.3752 27.5232V36.7937C26.3752 37.4599 26.9348 38 27.6251 38H34.6093C36.2248 38 37.574 36.8116 37.7212 35.2589L39.2113 19.5429H42.1249C42.9171 19.5429 43.6238 19.0624 43.8905 18.3425C44.1571 17.6226 43.9263 16.8187 43.3137 16.334L23.1884 0.410172Z" fill={color} />
    </Svg>
  );
}

const SOURCE_WIDTH = 44;
const SOURCE_HEIGHT = 38;
