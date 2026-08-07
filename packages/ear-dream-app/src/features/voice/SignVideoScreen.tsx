import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { MOCK_RECOGNIZED_SPEECH } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';

export interface SignVideoScreenProps {
  /** AppBar 뒤로가기 — 음성 입력 화면으로 복귀(다시 말하기는 이 경로로 해결, V2 시안 방침). */
  onBack: () => void;
}

/**
 * 재생 속도 선택지. 확정값이 아니라 V2 시안의 세그먼트 표기 그대로다.
 * 영상 재생이 미구현이라 선택 상태만 저장한다.
 */
const PLAYBACK_SPEEDS = ['0.5배', '1.0배', '1.5배'] as const;

/**
 * 수어로 보기 화면 (V2 시안 "수어로 보기"): 다크 비디오 카드(재생 중 배지 + 아바타 자리 +
 * 자막) + 소스 영역 + 재생 속도 세그먼트 + "다시 보기".
 *
 * 수어 영상 · STT 는 미구현이다. 문장은 목업(mock.ts)이고 "다시 보기"는 표시만 하는
 * placeholder 다(재생할 영상이 없다).
 */
export function SignVideoScreen({ onBack }: SignVideoScreenProps) {
  const [speedIndex, setSpeedIndex] = useState(1); // 기본 1.0배 (시안 선택 상태)

  return (
    <ScreenFrame
      title={strings.signVideo.appBarTitle}
      onBack={onBack}
      footer={
        <Button
          label={strings.signVideo.replay}
          variant="outline"
          // 영상 재생 미구현 — 다시 재생할 대상이 없어 표시만 한다.
          onPress={() => {}}
          testID="sign-video-replay"
        />
      }
    >
      <View style={styles.card} testID="sign-video-card">
        <View style={styles.cardTop}>
          <Badge label={strings.signVideo.playingBadge} variant="playing" />
        </View>
        <View style={styles.cardCenter}>
          {/* 수어 아바타/영상 자리 — 확정 자산 전 placeholder(원형). */}
          <View style={styles.avatarRing} accessibilityLabel={strings.signVideo.avatarAlt}>
            <View style={styles.avatar} />
          </View>
          <Text style={styles.caption}>{strings.signVideo.caption}</Text>
        </View>
        {/* 자막 — 농인이 읽는 텍스트이므로 크게 · 고대비(반투명 배경)로 렌더링한다. */}
        <View style={styles.subtitleStrip}>
          <Text style={styles.subtitleText} testID="sign-video-subtitle">
            {MOCK_RECOGNIZED_SPEECH}
          </Text>
        </View>
      </View>

      <View style={styles.sourceArea}>
        <Text style={styles.sourceLabel}>{strings.signVideo.sourceLabel}</Text>
        <Text style={styles.sourceSentence}>{MOCK_RECOGNIZED_SPEECH}</Text>
      </View>

      <View style={styles.speedArea}>
        <Text style={styles.speedLabel}>{strings.signVideo.speedLabel}</Text>
        <View style={styles.speedRow}>
          {PLAYBACK_SPEEDS.map((speed, index) => {
            const selected = index === speedIndex;
            return (
              <Pressable
                key={speed}
                accessibilityRole="button"
                accessibilityLabel={`${strings.signVideo.speedLabel} ${speed}`}
                accessibilityState={{ selected }}
                onPress={() => setSpeedIndex(index)}
                style={[styles.speedPill, selected && styles.speedPillSelected]}
                testID={`sign-video-speed-${index}`}
              >
                <Text style={[styles.speedText, selected && styles.speedTextSelected]}>{speed}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    padding: spacing.lg,
    backgroundColor: colors.bg.video,
  },
  cardTop: {
    alignSelf: 'flex-start',
  },
  cardCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  avatarRing: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  subtitleStrip: {
    marginHorizontal: -spacing.lg,
    marginBottom: -spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(11, 15, 20, 0.6)',
  },
  subtitleText: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 34,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  sourceArea: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  sourceLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
  },
  sourceSentence: {
    fontFamily: fonts.medium,
    fontSize: 18,
    color: colors.text.primary,
  },
  speedArea: {
    marginTop: spacing.lg,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
  },
  speedLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.text.secondary,
  },
  speedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  speedPill: {
    flex: 1,
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  speedPillSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primary,
  },
  speedText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text.primary,
  },
  speedTextSelected: {
    color: colors.text.onBrand,
  },
});
