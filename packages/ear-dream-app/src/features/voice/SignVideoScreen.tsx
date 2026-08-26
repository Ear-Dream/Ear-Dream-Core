import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SignSequenceItem } from '@ear-dream/core';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TrackSwitchHandle } from '../../components/TrackSwitchHandle';
import { strings } from '../../constants/strings';
import {
  colors,
  fonts,
  koreanWordBreak,
  maxScreenWidth,
  radius,
  spacing,
} from '../../constants/theme';
import { useDesignScale } from '../../hooks/useDesignScale';
import { createRequestId } from '../recognition/api/createRequestId';
import { AvatarPlayer, useSignSequence } from './avatar';

export interface SignVideoScreenProps {
  /**
   * 청인이 말한 문장 — 음성 인식(STT) 결과 또는 키보드 입력. 자막과 소스 영역에 그대로 쓴다.
   * 이 문장을 `POST /api/v1/sign-sequence` 로 보내 단어 열로 쪼개고, 각 단어의 좌표
   * 시퀀스(빌트인 시퀀스)를 아바타로 재생한다.
   */
  sentence: string;
  /**
   * "답장" — 농인 트랙(수어 입력)으로. 대화 턴이 상대에게 넘어가는 지점이다.
   * 시안에서는 화면 아래 **손 손잡이**가 이 동작이다.
   *
   * ⚠️ 시안에 이 화면의 **뒤로가기·홈이 없다**. `onBack` 은 요청(2026-08-25)으로
   * 되살린 시안 밖 경로이고, `onGoHome` 은 여전히 없다 — 첫 화면으로 가려면 손잡이로
   * 수어 트랙에 간 뒤 그쪽 손잡이를 쓴다.
   */
  onReply: () => void;
  /**
   * 「뒤로」 — 음성 입력 화면으로 되돌아간다. 다시 말하려는 경로다.
   *
   * 시안에 이 화면의 뒤로가기가 없어 한동안 지워 뒀는데, 요청(2026-08-25)으로
   * 「다시보기」와 나란한 두 버튼으로 되살렸다. 「답장하기」는 그대로 화면 아래
   * **손 손잡이**가 갖는다 — 세 갈래를 버튼 줄에 다 늘어놓지 않는다.
   */
  onBack: () => void;
}

/**
 * 재생 속도 — 확정 디자인의 **세 칸 세그먼트**다. 느린 쪽부터 왼쪽에 둔다.
 *
 * 한동안 아바타 위에 얹은 순환 버튼 하나로 대체해 뒀었다(화면 아래 한 줄을 아끼려고).
 * 확정 디자인이 세그먼트로 돌아왔고, 세 값이 전부 보이면 "지금 몇 배인지"와 "무엇을
 * 고를 수 있는지"를 한 번에 읽을 수 있다 — 순환 버튼은 눌러 봐야 알 수 있었다.
 */
/**
 * 재생 속도 — 시안 「최종」에 속도 조절 UI 가 없어 **등속 고정**이다.
 *
 * 이전에는 하단에 세 칸 세그먼트(0.5/1.0/1.5배)를 두었는데, 시안 어디에도 없어서 걷어냈다.
 * 조절이 필요하다는 판단이 서면 이 상수 대신 다시 세그먼트를 올린다 — 재생부
 * (`AvatarPlayer`)는 fps 를 그대로 받으므로 UI 만 얹으면 된다.
 */
const PLAYBACK_RATE = 1;

/** 자막이 카드 밑변에서 떨어지는 거리 — 시안 49pt(430pt 폭 기준)를 좁은 화면에 맞춘 값. */
const CAPTION_BOTTOM_INSET = 40;
/** 자막 글자 — 시안 Bold 32 를 좁은 화면용으로 한 단계 낮춘 값과 그 바닥값. */
const CAPTION_FONT_SIZE = 28;
const CAPTION_MIN_FONT_SIZE = 18;
/** 자막이 카드를 덮지 않도록 두는 상한 — 카드 높이 기준 비율이다. */
const CAPTION_MAX_HEIGHT_RATIO = '45%';
/**
 * 재생 불가 단어 목록이 차지할 수 있는 최대 높이(시안 기준). 세로 배율을 거쳐 쓴다.
 * ⚠️ 시안에 이 영역이 없어 **근거 없는 임시값**이다 — 아바타 카드가 살아남는 선에서
 * 목록 두 줄이 보이는 정도로 잡았다. 실기기에서 재고 정할 값이다.
 */
const NOTICE_AREA_MAX_HEIGHT = 132;

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
export function SignVideoScreen({ sentence, onReply, onBack }: SignVideoScreenProps) {
  const [playing, setPlaying] = useState(true);
  // "다시 보기" 신호. 값 자체엔 의미가 없고 **바뀌었다는 사실**이 재시작을 뜻한다.
  const [restartToken, setRestartToken] = useState(0);
  const [sessionId] = useState(createRequestId);
  const { v } = useDesignScale();

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

  const hasNotices = blocked.unknown.length > 0 || blocked.notReady.length > 0 || bundleMismatch;
  /**
   * 자막 글자 크기 — 시안 Bold 32(430pt 폭 기준)를 좁은 화면용으로 28 로 낮춰 둔 값에
   * 세로 배율을 태운다. 바닥값 아래로는 내려가지 않는다(읽는 것이 목적인 글자다).
   */
  const captionSize = Math.max(CAPTION_MIN_FONT_SIZE, v(CAPTION_FONT_SIZE));

  const footer =
        phase.name === 'failed' ? (
          <Button label={strings.signVideo.retry} onPress={retry} testID="sign-video-retry" />
        ) : (
          /*
            「뒤로」 + 「다시보기」 두 버튼(2026-08-25 요청). 시안의 하단 버튼은
            「다시보기」 하나였다(460:2326).

            「답장하기」는 화면 아래 **손 손잡이**(TrackSwitchHandle)가 그대로 갖는다 —
            아이콘이 가리키는 수어 트랙이 곧 답장이라, 버튼 줄에 세 갈래를 늘어놓지 않는다.

            Primary 는 「다시보기」 하나다(시안 Button 규칙: 화면당 primary 1개).
            「뒤로」는 이탈 경로라 outline 으로 내린다.
          */
          <View style={styles.buttonRow}>
            <View style={styles.buttonCell}>
              <Button
                label={strings.signVideo.back}
                variant="outline"
                onPress={onBack}
                testID="sign-video-back"
              />
            </View>
            <View style={styles.buttonCell}>
              <Button
                label={strings.signVideo.replay}
                disabled={sequences.length === 0}
                onPress={() => {
                  setPlaying(true);
                  setRestartToken((token) => token + 1);
                }}
                testID="sign-video-replay"
              />
            </View>
          </View>
        );

  const body = (
    <>
      <View style={[styles.card, { marginTop: v(spacing.sm) }]} testID="sign-video-card">
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
              fps={(result?.source_fps ?? 30) * PLAYBACK_RATE}
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
        {/*
          ⚠️ 상한(`maxHeight`)과 내부 스크롤이 있어야 한다. 없으면 긴 문장이 위로 자라
          아바타를 통째로 덮는다 — 자막은 보조 정보인데 주인공을 가려 버린다.
          `pointerEvents` 를 열어 둔 것도 이 스크롤 때문이다(아래에 눌릴 것이 없다).
        */}
        <View style={[styles.captionBox, { bottom: v(CAPTION_BOTTOM_INSET) }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              style={[styles.captionText, { fontSize: captionSize, lineHeight: captionSize * 1.4 }, koreanWordBreak]}
              testID="sign-video-caption"
            >
              {sentence}
            </Text>
          </ScrollView>
        </View>
      </View>

      {/*
        두 사유를 나눠 보여준다 — 사용자가 할 수 있는 일이 다르다.

        ⚠️ **높이 상한 안에서 스크롤시킨다.** 재생 불가 단어가 많으면 이 목록이 몇 줄이고
        늘어나는데, 위의 아바타 카드가 `flex` 라 그만큼 카드가 눌린다 — 단어 대여섯 개면
        카드가 사라지다시피 했다(2026-08-25 요청 「단어가 많을 때 UI 가 흐트러진다」).
        목록을 자르지 않고 카드를 지키는 방법이 상한 + 스크롤이다.
      */}
      {hasNotices ? (
        <View style={[styles.noticeArea, { maxHeight: v(NOTICE_AREA_MAX_HEIGHT) }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.root}>
      <View style={styles.card_frame}>{body}</View>
      <View style={[styles.footer, { paddingVertical: v(spacing.lg), gap: v(spacing.md) }]}>
        {footer}
      </View>

      {/* 시안 하단 흰 띠 — 수어 트랙(= 답장)으로 넘어가는 손잡이. */}
      <TrackSwitchHandle
        variant="toSign"
        onPress={onReply}
        accessibilityLabel={strings.signVideo.reply}
        testID="sign-video-reply"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    // 시안은 화면 전체가 인디고 면이고 하단 121pt 만 흰 띠다(손잡이 자리).
    backgroundColor: colors.bg.brandSurface,
  },
  card_frame: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    // 세로 여백은 세로 배율을 거쳐 인라인으로 들어온다.
  },
  /** 「뒤로」·「다시보기」 두 버튼을 같은 폭으로 나눠 갖는 줄. */
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  /**
   * Button 은 `alignSelf: 'stretch'` 라 부모 폭을 채운다 — 폭을 나누려면 이렇게
   * 감싸는 칸이 필요하다(Button 에 style prop 을 뚫지 않기 위한 선택).
   */
  buttonCell: {
    flex: 1,
  },
  // 확정 디자인 MotionCard — 430x932 프레임 기준 398x491, 반경 16, bg/video.
  // 높이는 flex 로 둔다: 하단 조작 영역이 정해지고 남는 공간이 시안 비율과 거의 같다.
  card: {
    flex: 1,
    // marginTop 은 세로 배율을 거쳐 인라인으로 들어온다.
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
    // bottom(CAPTION_BOTTOM_INSET)은 세로 배율을 거쳐 인라인으로 들어온다. 시안은 카드
    // 아래에서 49pt 띄운다(카드 높이의 10%) — 밑변에 붙이면 아바타의 발치를 가린다.
    left: spacing.lg,
    maxHeight: CAPTION_MAX_HEIGHT_RATIO,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    // 시안 bg/overlay 80%.
    backgroundColor: 'rgba(11, 15, 20, 0.8)',
  },
  captionText: {
    // 크기·행간은 세로 배율을 거쳐 인라인으로 들어온다(CAPTION_FONT_SIZE 주석).
    fontFamily: fonts.bold,
    letterSpacing: -0.4,
    color: colors.text.onVideo,
    textAlign: 'center',
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
  /** 재생 불가 목록의 바깥 상자 — 높이 상한이 인라인으로 들어오고 안에서 스크롤한다. */
  noticeArea: {
    flexShrink: 0,
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
