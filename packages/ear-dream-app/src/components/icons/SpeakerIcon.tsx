import Svg, { Path } from 'react-native-svg';

export interface SpeakerIconProps {
  size: number;
  color: string;
}

/**
 * 스피커(소리 나감) — 몸통은 채움, 음파는 두 겹의 호.
 *
 * 이전에는 View 두 개(사각형 + CSS 삼각형)로 흉내 낸 placeholder 였다. 시안(460:2674)에
 * 이 아이콘의 내보내기 애셋이 없어(그 자리가 스크린샷 이미지로 채워져 있다) **직접
 * 그렸다** — 확정 애셋이 나오면 이 파일만 갈아끼운다.
 *
 * 음파를 스트로크로 두는 이유: 채움으로 그리면 작은 크기에서 호 사이 간격이 뭉개진다.
 */
export function SpeakerIcon({ size, color }: SpeakerIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 몸통 + 원뿔 */}
      <Path
        d="M4 9h3.2l4.6-3.9a1 1 0 0 1 1.7.8v10.2a1 1 0 0 1-1.7.8L7.2 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z"
        fill={color}
      />
      {/* 음파 — 안쪽 · 바깥쪽 */}
      <Path
        d="M16.4 9.2a4 4 0 0 1 0 5.6"
        stroke={color}
        strokeWidth={2.1}
        strokeLinecap="round"
      />
      <Path
        d="M19.1 6.6a7.7 7.7 0 0 1 0 10.8"
        stroke={color}
        strokeWidth={2.1}
        strokeLinecap="round"
      />
    </Svg>
  );
}
