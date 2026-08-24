import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { strings } from '../../constants/strings';
import { colors, fonts, maxScreenWidth, spacing } from '../../constants/theme';

import { SignTrackIcon, VoiceTrackIcon } from './EntryIcons';

export interface HomeScreenProps {
  /** 농인 → 청인 트랙 시작 (수어 입력). */
  onStartSign: () => void;
  /** 청인 → 농인 트랙 시작 (음성 입력). */
  onStartVoice: () => void;
  /** 개발 빌드 전용: T-03 랜드마크 확인 화면 진입. 프로덕션에서는 넘기지 않는다. */
  onOpenLandmarkDev?: () => void;
}

/**
 * 진입 선택 화면 (피그마 「최종」 `2. 첫 화면 — 진입 선택`, 460:2650).
 *
 * 화면을 위/아래로 갈라 트랙 하나씩을 준다 — 위는 인디고 면 위의 「입으로 말하기」,
 * 아래는 흰 캔버스 위의 「손으로 말하기」. **시안에 글자가 없다.** 아이콘 타일 두 개가
 * 전부이고, 라벨은 스크린 리더용 `accessibilityLabel` 로만 싣는다(보이는 글자를 임의로
 * 추가하지 않되, 눌리는 것이 무엇인지 못 읽는 화면을 만들지도 않는다는 절충이다).
 *
 * ## 치수를 배율로 옮기는 이유
 *
 * 시안이 절대좌표(430pt 프레임)라 그대로는 다른 폭에서 깨진다. 프레임 폭 대비 배율
 * (`scale`) 하나로 모든 치수를 환산해 **비율을 시안 그대로 유지**한다. 타일 두 개가
 * 크기(263.865 vs 260)도 모서리 반경(71.041 vs 44.39)도 다른데, 이건 시안 원본이 그런
 * 것이라 한쪽으로 맞추지 않았다 — 확정 값이 나오면 여기 두 상수만 고친다.
 *
 * 타일 안 아이콘은 **가운데 정렬**이다 — 시안은 둘 다 조금씩 치우쳐 있지만
 * 사용자 요청(2026-08-24)으로 맞췄다.
 */
export function HomeScreen({ onStartSign, onStartVoice, onOpenLandmarkDev }: HomeScreenProps) {
  const { width } = useWindowDimensions();
  const frameWidth = Math.min(width, maxScreenWidth);
  const scale = frameWidth / DESIGN_FRAME_WIDTH;

  const voiceTile = VOICE_TILE_SIZE * scale;
  const signTile = SIGN_TILE_SIZE * scale;

  return (
    <View style={styles.root}>
      <View style={styles.voiceHalf}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.home.startVoice}
          onPress={onStartVoice}
          testID="home-start-voice"
          style={({ pressed }) => [
            styles.tile,
            {
              width: voiceTile,
              height: voiceTile,
              borderRadius: VOICE_TILE_RADIUS * scale,
            },
            pressed && styles.pressed,
          ]}
        >
          {/* 타일 한가운데. 시안은 살짝 치우쳐 있지만 중앙정렬로 맞췄다(아래 상수 주석). */}
          <VoiceTrackIcon size={VOICE_ICON_WIDTH * scale} />
        </Pressable>
      </View>

      <View style={styles.signHalf}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.home.startSign}
          onPress={onStartSign}
          testID="home-start-sign"
          style={({ pressed }) => [
            styles.tile,
            {
              width: signTile,
              height: signTile,
              borderRadius: SIGN_TILE_RADIUS * scale,
            },
            pressed && styles.pressed,
          ]}
        >
          {/* 손 아이콘의 원본 좌표계가 타일 전체라 여백이 패스에 이미 들어 있다. */}
          <SignTrackIcon size={signTile} />
        </Pressable>

        {onOpenLandmarkDev ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.home.landmarkDev}
            onPress={onOpenLandmarkDev}
            style={({ pressed }) => [styles.devLink, pressed && styles.pressed]}
            testID="home-landmark-dev"
          >
            <Text style={styles.devLinkText}>{strings.home.landmarkDev}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** 시안 프레임 폭 — 모든 치수를 이 값 대비 배율로 환산한다. */
const DESIGN_FRAME_WIDTH = 430;

/** 시안 상단 인디고 면 높이 485 / 하단 447 (총 932). flex 비율로 옮긴다. */
const VOICE_HALF_FLEX = 485;
const SIGN_HALF_FLEX = 932 - 485;

const VOICE_TILE_SIZE = 263.865;
const VOICE_TILE_RADIUS = 71.041;
/**
 * 마이크 아이콘 폭 — 시안 483:1580 실측(127.857x179).
 *
 * ⚠️ 시안은 타일 안에서 좌 70 · 상 43 으로 살짝 치우쳐 있는데, 사용자 요청(2026-08-24)으로
 * **가운데 정렬**한다. 아래 손 타일도 마찬가지다.
 */
const VOICE_ICON_WIDTH = 127.857;

const SIGN_TILE_SIZE = 260;
const SIGN_TILE_RADIUS = 44.39;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg.canvas,
  },
  voiceHalf: {
    flex: VOICE_HALF_FLEX,
    // 시안의 `brand/primary` 74% 면. 청인 입력 화면 전체가 같은 색이라 토큰으로 묶여 있다.
    backgroundColor: colors.bg.brandSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signHalf: {
    flex: SIGN_HALF_FLEX,
    backgroundColor: colors.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    // 타일 안 아이콘은 가운데. 손 아이콘은 원본 좌표계가 타일 전체라 정렬 영향이 없고,
    // 마이크는 정사각이 아니라 이 정렬이 실제로 위치를 정한다.
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.85,
  },
  devLink: {
    position: 'absolute',
    bottom: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  devLinkText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.text.secondary,
  },
});
