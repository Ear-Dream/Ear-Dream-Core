import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../constants/theme';
import { useDesignScale } from '../hooks/useDesignScale';

import { ChevronGlyph, HAND_SOURCE_WIDTH, HandOutlineIcon, MicOutlineIcon } from './icons/TrackIcons';

export interface TrackSwitchHandleProps {
  /**
   * 어느 트랙으로 넘어가는 손잡이인가.
   * - `toSign`: 청인 화면 **아래쪽**. 흰 띠 위의 손 + 위 화살촉.
   * - `toVoice`: 농인 화면 **위쪽**. 인디고 띠 위의 마이크 + 아래 화살촉.
   */
  variant: 'toSign' | 'toVoice';
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}

/**
 * 트랙 전환 손잡이 (피그마 「최종」 청인 하단 473:1230·1231 / 농인 상단 473:1212·467:742).
 *
 * 시안의 모든 입력·결과 화면은 **반대 트랙의 아이콘을 화면 끝에 반쯤 걸쳐 둔다** — 청인
 * 화면 아래에는 손, 농인 화면 위에는 마이크. 화살촉이 그쪽을 가리켜 "이리로 넘어간다"를
 * 말한다. 시안에 AppBar 가 없어 **이 손잡이가 화면의 유일한 네비게이션 어포던스**다.
 *
 * ⚠️ **넘어간 뒤 어디로 가는지는 시안에 없다.** 정지 프레임뿐이라 전환 대상이 특정되지
 * 않는다. 그래서 목적지를 컴포넌트가 정하지 않고 `onPress` 로 넘긴다.
 *
 * ## 치수
 *
 * 띠 높이와 그 안의 세로 위치는 **세로 배율**(`v`)로 옮긴다 — 화면이 짧아지면 띠도 같이
 * 얇아져야 아래 뷰파인더가 시안 비율을 지킬 수 있다(`useDesignScale` 주석 참고).
 * 아이콘은 도형이라 세로만 줄이면 찌그러지므로 `v` 하나로 **균등 축소**한다
 * (`vScale <= scale` 이라 좁은 폭에서도 넘치지 않는다).
 */
export function TrackSwitchHandle({
  variant,
  onPress,
  accessibilityLabel,
  testID,
}: TrackSwitchHandleProps) {
  const { frameWidth, v } = useDesignScale();

  const toSign = variant === 'toSign';
  const handWidth = v(HAND_SOURCE_WIDTH);
  const micWidth = v(VOICE_MIC_WIDTH);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.root,
        {
          height: v(toSign ? SIGN_STRIP_HEIGHT : VOICE_BAR_HEIGHT),
          backgroundColor: toSign ? colors.bg.canvas : colors.bg.brandSurface,
        },
        pressed && styles.pressed,
      ]}
    >
      {/* 시안 좌표를 그대로 쓰려면 430pt 프레임과 같은 폭의 기준면이 필요하다. */}
      <View style={[styles.frame, { width: frameWidth }]}>
        {toSign ? (
          <>
            {/* 위 화살촉 — 원본이 `＜` 라 시계방향 90도로 돌려 `∧` 를 만든다. */}
            <View
              style={[
                styles.absolute,
                {
                  top: v(SIGN_CHEVRON_TOP),
                  left: (frameWidth - v(SIGN_CHEVRON_LENGTH)) / 2,
                  transform: [{ rotate: '90deg' }],
                },
              ]}
            >
              <ChevronGlyph height={v(SIGN_CHEVRON_LENGTH)} color={colors.text.primary} />
            </View>
            {/* 손 — 시안이 30도 기울여 두었다. 가로는 중앙정렬(아래 주석). */}
            <View
              style={[
                styles.absolute,
                {
                  top: v(SIGN_HAND_TOP),
                  left: (frameWidth - handWidth) / 2,
                  transform: [{ rotate: '30deg' }],
                },
              ]}
            >
              <HandOutlineIcon size={handWidth} color={colors.text.primary} />
            </View>
          </>
        ) : (
          <>
            <View
              style={[
                styles.absolute,
                { top: v(VOICE_MIC_TOP), left: (frameWidth - micWidth) / 2 },
              ]}
            >
              <MicOutlineIcon size={micWidth} color={colors.text.onBrand} />
            </View>
            {/* 아래 화살촉 — 반시계방향 90도. */}
            <View
              style={[
                styles.absolute,
                {
                  top: v(VOICE_CHEVRON_TOP),
                  left: (frameWidth - v(VOICE_CHEVRON_LENGTH)) / 2,
                  transform: [{ rotate: '-90deg' }],
                },
              ]}
            >
              <ChevronGlyph height={v(VOICE_CHEVRON_LENGTH)} color={colors.text.onBrand} />
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}

/**
 * 청인 화면 하단 흰 띠: 시안 y 811~932 (= 121).
 * 농인 화면 상단 인디고 띠: 시안 y 0~123.
 *
 * ⚠️ 손·마이크·화살촉은 모두 프레임 **가로 중앙**에 놓는다. 시안은 손만 중앙(215)이
 * 아니라 242 에 두었는데, 사용자 요청(2026-08-24)으로 중앙정렬로 바꿨다 — 화살촉은
 * 중앙인데 손만 오른쪽으로 치우쳐 보이던 문제다.
 */
export const SIGN_STRIP_HEIGHT = 121;
export const VOICE_BAR_HEIGHT = 123;

/** 띠 안에서의 세로 위치(청인 띠 상단 811 기준). */
const SIGN_CHEVRON_TOP = 824 - 811;
const SIGN_CHEVRON_LENGTH = 18;
const SIGN_HAND_TOP = 879.5 - 811 - 64.0476 / 2;

const VOICE_MIC_TOP = 31;
const VOICE_MIC_WIDTH = 37;
const VOICE_CHEVRON_TOP = 99;
const VOICE_CHEVRON_LENGTH = 18;

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignItems: 'center',
  },
  frame: {
    flex: 1,
  },
  absolute: {
    position: 'absolute',
  },
  pressed: {
    opacity: 0.7,
  },
});
