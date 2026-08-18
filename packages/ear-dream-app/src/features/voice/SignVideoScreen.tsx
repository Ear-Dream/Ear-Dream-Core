import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SignSequenceItem } from '@ear-dream/core';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';
import { createRequestId } from '../recognition/api/createRequestId';
import { AvatarPlayer, useSignSequence } from './avatar';

export interface SignVideoScreenProps {
  /**
   * 청인이 말한 문장 — 음성 인식(STT) 결과 또는 키보드 입력. 자막과 소스 영역에 그대로 쓴다.
   * 이 문장을 `POST /api/v1/sign-sequence` 로 보내 단어 열로 쪼개고, 각 단어의 좌표
   * 시퀀스(빌트인 시퀀스)를 아바타로 재생한다.
   */
  sentence: string;
  /** AppBar 뒤로가기 — 음성 입력 화면으로 복귀(다시 말하기는 이 경로로 해결, V2 시안 방침). */
  onBack: () => void;
}

/**
 * 재생 속도 — **누를 때마다 순환**한다(1 → 1.5 → 0.5 → 1).
 *
 * V2 시안은 세 칸짜리 세그먼트였지만 화면 아래를 한 줄 통째로 먹었다. 아바타 위에
 * 얹은 작은 버튼 하나로 같은 일을 하고 그만큼 인물을 크게 볼 수 있다.
 * 순환 순서는 기본값(1배)에서 시작해 **빠르게 → 느리게** 다.
 */
const PLAYBACK_SPEEDS = [
  { label: '1.0배', rate: 1 },
  { label: '1.5배', rate: 1.5 },
  { label: '0.5배', rate: 0.5 },
] as const;

/**
 * 수어로 보기 화면 (V2 시안 "수어로 보기"): 아바타 카드(재생 중 배지 + 속도 버튼) +
 * 소스 영역 + "다시 보기".
 *
 * 시안의 **자막 스트립과 속도 세그먼트는 뺐다.** 자막은 바로 아래 "상대방이 말한 내용"
 * 과 같은 문장이라 두 번 보여줄 이유가 없고, 세그먼트는 한 줄을 통째로 먹었다.
 * 둘을 없앤 만큼 아바타가 커진다 — 이 화면에서 정보를 나르는 건 인물이다.
 *
 * 표시는 **임시 아바타**(`AvatarPlayer`)다 — 같은 좌표에 살을 붙이고 얼굴 78점으로
 * 표정까지 그린다. ⚠️ 시퀀스가 xy 2D 라 실제 3D 리깅이 아니라 명암으로 입체감을 흉내 낸
 * 것이고, **손바닥 방향은 표현할 수 없다**(2D 로는 전완 롤이 정해지지 않는다).
 *
 * 재생 불가 사유를 **두 종류로 나눠 보여준다** — 어휘에 없는 단어(unknown_word)와
 * 어휘엔 있으나 동작 시퀀스가 없는 단어(no_sequence)는 사용자가 할 수 있는 일이 다르다.
 */
export function SignVideoScreen({ sentence, onBack }: SignVideoScreenProps) {
  const [speedIndex, setSpeedIndex] = useState(0); // 기본 1.0배
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
            <AvatarPlayer
              sequences={sequences}
              fps={(result?.source_fps ?? 30) * PLAYBACK_SPEEDS[speedIndex].rate}
              playing={playing}
              restartToken={restartToken}
              onFinished={() => setPlaying(false)}
              testID="sign-video-avatar"
            />
          ) : (
            <Text style={[styles.caption, styles.captionWarning]} testID="sign-video-nothing">
              {result ? strings.signVideo.nothingPlayable : strings.signVideo.sequencesMissing}
            </Text>
          )}
        </View>

        {/* 배지·속도는 아바타 위에 얹는다 — 세로 공간을 인물에게 준다. */}
        {/* 재생 중에만 띄운다 — 끝난 뒤에도 "재생 중" 이면 화면이 멈춘 건지
            원래 그런 건지 알 수 없다. 끝난 상태의 안내는 "다시 보기" 버튼이 맡는다. */}
        {playing && sequences.length > 0 ? (
          <View style={styles.cardTop} pointerEvents="none">
            <Badge label={strings.signVideo.playingBadge} variant="playing" />
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${strings.signVideo.speedLabel} ${PLAYBACK_SPEEDS[speedIndex].label}`}
          onPress={() => setSpeedIndex((index) => (index + 1) % PLAYBACK_SPEEDS.length)}
          style={styles.speedButton}
          testID="sign-video-speed"
        >
          <Text style={styles.speedButtonText}>{PLAYBACK_SPEEDS[speedIndex].label}</Text>
        </Pressable>
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

    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    // 배경이 밝아야 한다 — 아바타의 머리카락이 어두운 색이라 어두운 배경에서는
    // 머리 윤곽이 사라진다. 카메라 영상이 아니라 그림이라 어두운 무대일 이유도 없다.
    backgroundColor: colors.bg.surface,
  },
  cardCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 배지·속도 버튼은 아바타 위에 떠 있다 — 세로 공간을 인물에게 준다. */
  cardTop: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
  },
  speedButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: touchTarget.minHeight,
    minWidth: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.bg.canvas,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  speedButtonText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text.primary,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text.secondary,
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
