import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SignSequenceItem } from '@ear-dream/core';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { HomeAction } from '../../components/HomeAction';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, koreanWordBreak, radius, spacing, touchTarget } from '../../constants/theme';
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
  /** "답장하기" — 농인 트랙(수어 입력)으로. 대화 턴이 상대에게 넘어가는 지점이다. */
  onReply: () => void;
  /** AppBar 홈 버튼 — 세션을 끝내고 첫 화면으로. */
  onGoHome: () => void;
}

/**
 * 재생 속도 — 확정 디자인의 **세 칸 세그먼트**다. 느린 쪽부터 왼쪽에 둔다.
 *
 * 한동안 아바타 위에 얹은 순환 버튼 하나로 대체해 뒀었다(화면 아래 한 줄을 아끼려고).
 * 확정 디자인이 세그먼트로 돌아왔고, 세 값이 전부 보이면 "지금 몇 배인지"와 "무엇을
 * 고를 수 있는지"를 한 번에 읽을 수 있다 — 순환 버튼은 눌러 봐야 알 수 있었다.
 */
const PLAYBACK_SPEEDS = [
  { label: '0.5배', rate: 0.5 },
  { label: '1.0배', rate: 1 },
  { label: '1.5배', rate: 1.5 },
] as const;

/** 기본 재생 속도(1.0배)의 인덱스. */
const DEFAULT_SPEED_INDEX = 1;

/** 자막이 카드 밑변에서 떨어지는 거리 — 시안 49pt(430pt 폭 기준)를 좁은 화면에 맞춘 값. */
const CAPTION_BOTTOM_INSET = 40;

/**
 * 수어로 보기 화면 (확정 디자인 「4. 청인 입력 — 결과(수어)」): 아바타 카드(재생 중 배지
 * + 자막) + 재생 속도 세그먼트 + "답장하기"/"다시보기".
 *
 * 자막과 속도 세그먼트는 확정 디자인(2026-08-19)에 맞춰 되살렸다. 자막이 카드 안으로
 * 들어오면서 아래 있던 "상대방이 말한 내용"·"재생한 단어" 영역은 뺐다 — 같은 문장을 두 번
 * 보여주지 않는다는 판단은 그대로고, 확정 디자인이 고른 자리가 카드 안일 뿐이다.
 * (시안에도 `Source` 레이어가 높이 10 으로 접힌 채 남아 있다 — 비운 자리라는 뜻이다.)
 *
 * ⚠️ 카드 배경은 시안대로 **다크**다. 아바타의 머리카락(#3a2418)이 어두워 윤곽이 배경에
 * 묻히는 트레이드오프가 있지만, 시안 충실이 우선이라는 판단(2026-08-19)이다. 인물이 안
 * 보이는 수준이면 아바타 팔레트(`avatar/avatarTuning.ts`)의 hair 를 밝히는 쪽으로 푼다 —
 * 카드를 밝히는 쪽으로 되돌리지 말 것.
 *
 * 표시는 **임시 아바타**(`AvatarPlayer`)다 — 같은 좌표에 살을 붙이고 얼굴 78점으로
 * 표정까지 그린다. ⚠️ 시퀀스가 xy 2D 라 실제 3D 리깅이 아니라 명암으로 입체감을 흉내 낸
 * 것이고, **손바닥 방향은 표현할 수 없다**(2D 로는 전완 롤이 정해지지 않는다).
 *
 * 재생 불가 사유를 **두 종류로 나눠 보여준다** — 어휘에 없는 단어(unknown_word)와
 * 어휘엔 있으나 동작 시퀀스가 없는 단어(no_sequence)는 사용자가 할 수 있는 일이 다르다.
 */
export function SignVideoScreen({ sentence, onBack, onReply, onGoHome }: SignVideoScreenProps) {
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
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

  return (
    <ScreenFrame
      title={strings.signVideo.appBarTitle}
      onBack={onBack}
      headerRight={<HomeAction onPress={onGoHome} testID="sign-video-home" />}
      footer={
        phase.name === 'failed' ? (
          <Button label={strings.signVideo.retry} onPress={retry} testID="sign-video-retry" />
        ) : (
          <>
            {/* 속도 세그먼트는 하단 조작 영역 안이다 — 엄지 범위에 있어야 하는 조작이다. */}
            <View style={styles.speedCard} testID="sign-video-speed">
              <Text style={styles.speedLabel}>{strings.signVideo.speedLabel}</Text>
              <View style={styles.speedSegments}>
                {PLAYBACK_SPEEDS.map((speed, index) => {
                  const active = index === speedIndex;
                  return (
                    <Pressable
                      key={speed.label}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${strings.signVideo.speedLabel} ${speed.label}`}
                      onPress={() => setSpeedIndex(index)}
                      style={({ pressed }) => [
                        styles.speedSegment,
                        active && styles.speedSegmentActive,
                        pressed && styles.speedSegmentPressed,
                      ]}
                      testID={`sign-video-speed-${speed.rate}`}
                    >
                      <Text style={[styles.speedText, active && styles.speedTextActive]}>
                        {speed.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Button label={strings.signVideo.reply} onPress={onReply} testID="sign-video-reply" />
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
          </>
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

        {/* 배지는 아바타 위에 얹는다 — 세로 공간을 인물에게 준다. */}
        {/* 재생 중에만 띄운다 — 끝난 뒤에도 "재생 중" 이면 화면이 멈춘 건지
            원래 그런 건지 알 수 없다. 끝난 상태의 안내는 "다시보기" 버튼이 맡는다. */}
        {playing && sequences.length > 0 ? (
          <View style={styles.cardTop} pointerEvents="none">
            <Badge label={strings.signVideo.playingBadge} variant="playing" />
          </View>
        ) : null}

        {/* 자막(확정 디자인 Caption) — 카드 안에 떠 있는 라운드 오버레이. 청인이 말한
            문장 그대로다. 아바타 조음이 아직 검증 전이라 "무슨 말인지"를 글로도 확인할 수
            있어야 한다. */}
        <View style={styles.captionBox} pointerEvents="none">
          <Text style={[styles.captionText, koreanWordBreak]} testID="sign-video-caption">
            {sentence}
          </Text>
        </View>
      </View>

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
  // 확정 디자인 MotionCard — 430x932 프레임 기준 398x491, 반경 16, bg/video.
  // 높이는 flex 로 둔다: 하단 조작 영역이 정해지고 남는 공간이 시안 비율과 거의 같다.
  card: {
    flex: 1,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bg.video,
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
  /** 자막(확정 디자인 Caption) — 카드 안에 16 만큼 들어와 떠 있는 반투명 라운드 박스. */
  captionBox: {
    position: 'absolute',
    right: spacing.lg,
    // 시안은 카드 아래에서 49pt 띄운다(카드 높이의 10%). 카드 밑변에 붙이면 자막이
    // 아바타의 발치를 가려 구도가 달라진다.
    bottom: CAPTION_BOTTOM_INSET,
    left: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    // 시안 bg/overlay 80%.
    backgroundColor: 'rgba(11, 15, 20, 0.8)',
  },
  captionText: {
    // 시안은 430pt 폭 기준 Bold 32(행간 140%)다. 좁은 화면에 맞춰 한 단계 줄였다.
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 39,
    letterSpacing: -0.4,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  /** 재생 속도(확정 디자인 Speed) — 398x93 · 반경 12 · bg/surface 카드. */
  speedCard: {
    gap: spacing.sm - 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  speedLabel: {
    fontFamily: fonts.medium,
    fontSize: 16,
    letterSpacing: -0.3,
    color: colors.text.primary,
  },
  speedSegments: {
    flexDirection: 'row',
    gap: spacing.lg - 1,
  },
  speedSegment: {
    flex: 1,
    // 시안 실측 50 — 최소 터치 타겟(48)을 넘긴다.
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  speedSegmentActive: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primary,
  },
  speedSegmentPressed: {
    opacity: 0.8,
  },
  speedText: {
    // 시안 Bold 24 → 좁은 화면 보정.
    fontFamily: fonts.bold,
    fontSize: 21,
    letterSpacing: -0.3,
    color: colors.text.primary,
  },
  speedTextActive: {
    color: colors.text.onBrand,
  },
  /** 카드 안 상태 문구(준비 중 · 실패 · 재생할 게 없음). 다크 카드 위라 on-video 색이다. */
  caption: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.onVideo,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  /** 다크 카드 위에서는 진한 빨강이 어두워 안 읽힌다 — 연빨강을 쓴다. */
  captionWarning: {
    color: colors.status.errorSoft,
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
