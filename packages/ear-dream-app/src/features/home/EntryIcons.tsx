import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../../constants/theme';

import { ENTRY_ICON_SIZE } from './EntryButton';

/**
 * 첫 화면 트랙 아이콘 — **확정 애셋 전 임시 도형**이다.
 *
 * 확정 디자인의 아이콘(손·입)은 아직 준비 중이라 애셋이 없다. 자리를 빈 칸으로 두면
 * 버튼이 고장난 것처럼 보이므로, 같은 크기·같은 무게(단색 실루엣)의 근사 도형을 그려
 * 레이아웃을 확정해 둔다. 애셋이 나오면 **이 파일만** 갈아끼우면 된다 —
 * 크기는 `ENTRY_ICON_SIZE` 하나로 묶여 있다.
 */

/** 「손으로 말하기」 — 펼친 손 실루엣. */
export function SignTrackIcon() {
  return (
    <Svg width={ENTRY_ICON_SIZE} height={ENTRY_ICON_SIZE} viewBox="0 0 44 44" fill="none">
      <Rect x={13} y={6} width={5.5} height={19} rx={2.75} fill={colors.text.primary} />
      <Rect x={19.5} y={3} width={5.5} height={22} rx={2.75} fill={colors.text.primary} />
      <Rect x={26} y={6} width={5.5} height={19} rx={2.75} fill={colors.text.primary} />
      <Path
        d="M9 20c0-2.2 2.9-3.2 4.2-1.4l3.3 4.6V26H9v-6Z"
        fill={colors.text.primary}
      />
      <Path
        d="M11 24h22v6a10 10 0 0 1-10 10h-2a10 10 0 0 1-10-10v-6Z"
        fill={colors.text.primary}
      />
    </Svg>
  );
}

/** 「입으로 말하기」 — 말하는 얼굴 실루엣. */
export function VoiceTrackIcon() {
  return (
    <Svg width={ENTRY_ICON_SIZE} height={ENTRY_ICON_SIZE} viewBox="0 0 44 44" fill="none">
      <Path
        d="M22 4c9.4 0 17 7.2 17 16.1 0 8.9-7.6 16.1-17 16.1-1.6 0-3.2-.2-4.7-.6l-7.8 3.9a1.2 1.2 0 0 1-1.7-1.3l1.4-6.6C5.2 28.7 5 24.6 5 20.1 5 11.2 12.6 4 22 4Z"
        fill={colors.text.primary}
      />
      <Circle cx={22} cy={20} r={5.5} fill={colors.bg.canvas} />
    </Svg>
  );
}
