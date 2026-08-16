import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SignSequenceItem } from '@ear-dream/core';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';
import { createRequestId } from '../recognition/api/createRequestId';
import { SkeletonPlayer, useSignSequence } from './avatar';

export interface SignVideoScreenProps {
  /**
   * 청인이 말한 문장 — 음성 인식(STT) 결과 또는 키보드 입력. 자막과 소스 영역에 그대로 쓴다.
   * 이 문장을 `POST /api/v1/sign-sequence` 로 보내 단어 열로 쪼개고, 각 단어의 좌표
   * 시퀀스(빌트인 자산)를 스켈레톤으로 재생한다.
   */
  sentence: string;
  /** AppBar 뒤로가기 — 음성 입력 화면으로 복귀(다시 말하기는 이 경로로 해결, V2 시안 방침). */
  onBack: () => void;
}

/**
 * 재생 속도 선택지. 확정값이 아니라 V2 시안의 세그먼트 표기 그대로다.
 * 영상 재생이 미구현이라 선택 상태만 저장한다.
 */
const PLAYBACK_SPEEDS = [
  { label: '0.5배', rate: 0.5 },
  { label: '1.0배', rate: 1 },
  { label: '1.5배', rate: 1.5 },
] as const;

/**
 * 수어로 보기 화면 (V2 시안 "수어로 보기"): 다크 비디오 카드(재생 중 배지 + 아바타 자리 +
 * 자막) + 소스 영역 + 재생 속도 세그먼트 + "다시 보기".
 *
 * 아바타는 3D 사람 형상이 아니라 **랜드마크 스켈레톤**이다(손·상체 골격 + 얼굴 점).
 * 좌표 자산이 그것뿐이고, 시연에는 손 모양이 보이는 것으로 충분하다는 판단이다.
 *
 * 재생 불가 사유를 **두 종류로 나눠 보여준다** — 어휘에 없는 단어(unknown_word)와
 * 어휘엔 있으나 동작 자산이 없는 단어(no_sequence)는 사용자가 할 수 있는 일이 다르다.
 */
export function SignVideoScreen({ sentence, onBack }: SignVideoScreenProps) {
  const [speedIndex, setSpeedIndex] = useState(1); // 기본 1.0배 (시안 선택 상태)
  const [playing, setPlaying] = useState(true);
  // "다시 보기" 신호. 값 자체엔 의미가 없고 **바뀌었다는 사실**이 재시작을 뜻한다.
  const [restartToken, setRestartToken] = useState(0);
  const [sessionId] = useState(createRequestId);

  const { phase, bundleMismatch, request, retry } = useSignSequence(sessionId);

  useEffect(() => {
    request(sentence);
  }, [request, sentence]);

  const result = phase.name === 'ready' ? phase.result : null;
  const sequences = phase.name === 'ready' ? phase.sequences : [];

  // 재생 불가 항목을 사유별로 나눈다 — 화면에서 뭉뚱그리지 않기 위해.
  const blocked = useMemo(() => {
    const unknown: string[] = [];
    const notReady: string[] = [];
    for (const item of (result?.items ?? []) as SignSequenceItem[]) {
      if (item.sequence_key) continue;
      if (item.issue === 'no_sequence') notReady.push(item.label ?? item.source_text);
      else unknown.push(item.source_text);
    }
    return { unknown, notReady };
  }, [result]);

  const playedLabels = useMemo(
    () =>
      ((result?.items ?? []) as SignSequenceItem[])
        .filter((item) => item.sequence_key)
        .map((item) => item.label ?? item.source_text),
    [result],
  );

  return (
    <ScreenFrame
      title={strings.signVideo.appBarTitle}
      onBack={onBack}
      footer={
        phase.name === 'failed' ? (
          <Button label={strings.signVideo.retry} onPress={retry} testID="sign-video-retry" />
        ) : (
          <Button
            label={strings.signVideo.replay}
            variant="outline"
            disabled={sequences.length === 0}
            onPress={() => {
              setPlaying(true);
              setRestartToken((token) => token + 1);
            }}
            testID="sign-video-replay"
          />
        )
      }
    >
      <View style={styles.card} testID="sign-video-card">
        <View style={styles.cardTop}>
          <Badge label={strings.signVideo.playingBadge} variant="playing" />
        </View>
        <View style={styles.cardCenter}>
          {phase.name === 'pending' ? (
            <Text style={styles.caption} testID="sign-video-preparing">
              {strings.signVideo.preparing}
            </Text>
          ) : phase.name === 'failed' ? (
            <Text style={[styles.caption, styles.captionWarning]} testID="sign-video-failed">
              {strings.signVideo.requestFailed}
            </Text>
          ) : sequences.length > 0 ? (
            <SkeletonPlayer
              sequences={sequences}
              fps={(result?.source_fps ?? 30) * PLAYBACK_SPEEDS[speedIndex].rate}
              playing={playing}
              restartToken={restartToken}
              onFinished={() => setPlaying(false)}
              testID="sign-video-skeleton"
            />
          ) : (
            <Text style={[styles.caption, styles.captionWarning]} testID="sign-video-nothing">
              {result ? strings.signVideo.nothingPlayable : strings.signVideo.assetsMissing}
            </Text>
          )}
        </View>
        {/* 자막 — 농인이 읽는 텍스트이므로 크게 · 고대비(반투명 배경)로 렌더링한다. */}
        <View style={styles.subtitleStrip}>
          <Text style={styles.subtitleText} testID="sign-video-subtitle">
            {sentence}
          </Text>
        </View>
      </View>

      <View style={styles.sourceArea}>
        <Text style={styles.sourceLabel}>{strings.signVideo.sourceLabel}</Text>
        <Text style={styles.sourceSentence}>{sentence}</Text>
      </View>

      {playedLabels.length > 0 ? (
        <View style={styles.wordsRow} testID="sign-video-played-words">
          <Text style={styles.sourceLabel}>{strings.signVideo.playedWordsLabel}</Text>
          <Text style={styles.sourceSentence}>{playedLabels.join(' · ')}</Text>
        </View>
      ) : null}

      {/* 두 사유를 나눠 보여준다 — 사용자가 할 수 있는 일이 다르다. */}
      {blocked.unknown.length > 0 ? (
        <View style={styles.noticeRow} testID="sign-video-unknown">
          <Text style={styles.noticeText}>
            {strings.signVideo.unknownWords}: {blocked.unknown.join(', ')}
          </Text>
        </View>
      ) : null}
      {blocked.notReady.length > 0 ? (
        <View style={styles.noticeRow} testID="sign-video-not-ready">
          <Text style={styles.noticeText}>
            {strings.signVideo.notReadyWords}: {blocked.notReady.join(', ')}
          </Text>
        </View>
      ) : null}
      {bundleMismatch ? (
        <View style={[styles.noticeRow, styles.noticeWarning]} testID="sign-video-mismatch">
          <Text style={[styles.noticeText, styles.captionWarning]}>
            {strings.signVideo.bundleMismatch}
          </Text>
        </View>
      ) : null}

      <View style={styles.speedArea}>
        <Text style={styles.speedLabel}>{strings.signVideo.speedLabel}</Text>
        <View style={styles.speedRow}>
          {PLAYBACK_SPEEDS.map((speed, index) => {
            const selected = index === speedIndex;
            return (
              <Pressable
                key={speed.label}
                accessibilityRole="button"
                accessibilityLabel={`${strings.signVideo.speedLabel} ${speed.label}`}
                accessibilityState={{ selected }}
                onPress={() => setSpeedIndex(index)}
                style={[styles.speedPill, selected && styles.speedPillSelected]}
                testID={`sign-video-speed-${index}`}
              >
                <Text style={[styles.speedText, selected && styles.speedTextSelected]}>
                  {speed.label}
                </Text>
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
  captionWarning: {
    color: colors.status.error,
  },
  wordsRow: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  noticeRow: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  noticeWarning: {
    borderWidth: 1,
    borderColor: colors.status.error,
  },
  noticeText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
  },
});
