import Svg, { Path } from 'react-native-svg';

export interface SendIconProps {
  size: number;
  color: string;
}

/**
 * 종이비행기(보내기).
 *
 * 시안에 이 아이콘 애셋이 없다 — 시안의 「전달」 버튼은 글자 + 화살촉이었는데, 사용자
 * 요청(2026-08-24)으로 글자를 빼고 종이비행기 하나로 바꿨다. 그래서 이 도형은 **시안
 * 내보내기가 아니라 직접 그린 것**이다. 확정 애셋이 나오면 이 파일만 갈아끼운다.
 *
 * 스트로크로 그린다 — 같은 화면의 다른 아이콘(손·화살촉)이 전부 스트로크라 무게가 맞는다.
 * 획 굵기는 24 좌표계 기준 2 이고, `size` 로 확대해도 비율이 유지된다.
 */
export function SendIcon({ size, color }: SendIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 2 15 22l-4-9-9-4 20-7Z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 접힌 날개 — 이 선이 없으면 단순 삼각형으로 읽힌다. */}
      <Path d="M22 2 11 13" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
