import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { colors, maxScreenWidth } from '../constants/theme';

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
 * 않는다. 그래서 목적지를 컴포넌트가 정하지 않고 `onPress` 로 넘긴다 — 현재 배선은 각
 * 화면의 기존 뒤로가기 경로(첫 화면)를 그대로 쓴다. 아이콘이 가리키는 "반대 트랙으로 직행"
 * 이 맞다면 호출부만 바꾸면 된다.
 *
 * 치수는 시안 430pt 프레임 기준 절대좌표를 배율로 환산한다(HomeScreen 과 같은 방식).
 */
export function TrackSwitchHandle({
  variant,
  onPress,
  accessibilityLabel,
  testID,
}: TrackSwitchHandleProps) {
  const { width } = useWindowDimensions();
  const frameWidth = Math.min(width, maxScreenWidth);
  const scale = frameWidth / DESIGN_FRAME_WIDTH;

  const toSign = variant === 'toSign';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.root,
        {
          height: (toSign ? SIGN_STRIP_HEIGHT : VOICE_BAR_HEIGHT) * scale,
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
                  top: SIGN_CHEVRON_TOP * scale,
                  left: (FRAME_CENTER_X - SIGN_CHEVRON_LENGTH / 2) * scale,
                  transform: [{ rotate: '90deg' }],
                },
              ]}
            >
              <ChevronGlyph height={SIGN_CHEVRON_LENGTH * scale} color={colors.text.primary} />
            </View>
            {/* 손 — 시안이 30도 기울여 두었고, 가로 중앙(215)이 아니라 242 에 있다. */}
            <View
              style={[
                styles.absolute,
                {
                  top: SIGN_HAND_TOP * scale,
                  left: (FRAME_CENTER_X - HAND_SOURCE_WIDTH / 2) * scale,
                  transform: [{ rotate: '30deg' }],
                },
              ]}
            >
              <HandOutlineIcon size={HAND_SOURCE_WIDTH * scale} color={colors.text.primary} />
            </View>
          </>
        ) : (
          <>
            <View
              style={[
                styles.absolute,
                { top: VOICE_MIC_TOP * scale, left: (215 - VOICE_MIC_WIDTH / 2) * scale },
              ]}
            >
              <MicOutlineIcon size={VOICE_MIC_WIDTH * scale} color={colors.text.onBrand} />
            </View>
            {/* 아래 화살촉 — 반시계방향 90도. */}
            <View
              style={[
                styles.absolute,
                {
                  top: VOICE_CHEVRON_TOP * scale,
                  left: (FRAME_CENTER_X - VOICE_CHEVRON_LENGTH / 2) * scale,
                  transform: [{ rotate: '-90deg' }],
                },
              ]}
            >
              <ChevronGlyph height={VOICE_CHEVRON_LENGTH * scale} color={colors.text.onBrand} />
            </View>
          </>
        )}
      </View>
    </Pressable>
  );
}

const DESIGN_FRAME_WIDTH = 430;

/** 청인 화면 하단 흰 띠: 시안 y 811~932. */
const SIGN_STRIP_HEIGHT = 121;
/** 띠 안에서의 위치(띠 상단 811 기준). */
const SIGN_CHEVRON_TOP = 824 - 811;
const SIGN_CHEVRON_LENGTH = 18;
const SIGN_HAND_TOP = 879.5 - 811 - 64.0476 / 2;
/**
 * 손·마이크·화살촉은 모두 프레임 가로 중앙에 놓는다.
 *
 * ⚠️ 시안은 손만 중앙(215)이 아니라 242 에 두었는데, 사용자 요청(2026-08-24)으로
 * 중앙정렬로 바꿨다 — 화살촉은 중앙인데 손만 오른쪽으로 치우쳐 보이던 문제다.
 */
const FRAME_CENTER_X = 215;

/** 농인 화면 상단 인디고 띠: 시안 y 0~123. */
const VOICE_BAR_HEIGHT = 123;
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
