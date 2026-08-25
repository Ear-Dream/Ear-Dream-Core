import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { SentenceCandidate } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { SpinnerRing } from '../../components/SpinnerRing';
import { TrackSwitchHandle } from '../../components/TrackSwitchHandle';
import { Waveform } from '../../components/Waveform';
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
import type { ComposerPhase } from '../recognition/api/useSentenceComposer';
import { useSpeech } from './speech';
import { SpeakerButton, type SpeakerStatus } from './SpeakerButton';
import { useSpeakingWaveform } from './useSpeakingWaveform';

export interface ResultScreenProps {
  /** /compose-sentence 호출 상태. pending = 로딩, failed = 재전송 UI. */
  phase: ComposerPhase;
  /** 전송 실패 시 재전송 (단어 열은 보존되어 있다). */
  onRetry: () => void;
  /**
   * "답장" — 청인 트랙(음성 입력)으로. 세션 종료(칩 비움)를 겸한다.
   * 시안에서는 상단 **트랙 전환 손잡이**(마이크 + 아래 화살촉)가 이 동작이다.
   */
  onReply: () => void;
  /** 하단 「뒤로」 — 입력 화면으로 복귀(칩 유지, 단어 추가·수정 가능). */
  onBack: () => void;
}

/**
 * 음성 전달 화면 (확정 디자인 「5. 농인 입력 — 결과(음성/텍스트)」): 본문을 채우는
 * brand/subtle 카드 — 스피커 + 파형 + 문장 + 캡션.
 * 문장은 /compose-sentence 결과다(입력 단어 병기 · word_list 구분 · 실패 시 재전송 포함).
 *
 * 문장이 완성되면 실제로 읽는다. 폰을 든 사람은 그 소리를 듣지 못하므로 "지금 말하고
 * 있어요"를 눈으로도 보여준다 — 소리로만 전달되는 피드백을 만들지 않는다는 원칙이다.
 * 청인이 읽는 문장이라 큰 글자 · 고대비로 렌더링한다.
 *
 * 재생 조작은 스피커 아이콘 자체가 맡는다(SpeakerButton). 아이콘이 소리를 뜻하는 자리에
 * 있으면서 장식이기만 하면, 눌러본 사람은 고장으로 받아들인다. 하단 버튼 자리는
 * "답장하기"(청인 트랙으로 넘어가기) 하나다 — 문장을 들려준 다음의 실제 다음 행동이고,
 * 세션을 끝내는 "처음으로"는 AppBar 홈 버튼으로 올렸다(확정 디자인 배치).
 *
 * 파형은 확정 디자인(2026-08-19)에 맞춰 되살렸다. 재생 엔진이 오디오 레벨을 노출하지
 * 않는 사정은 그대로여서 **실측 파형이 아니고**, 그래서 모양은 시안의 고정 프로필을 쓰고
 * 움직임만 재생 중에 준다 — 근거와 지키는 선은 `useSpeakingWaveform` 주석에 있다.
 *
 * ⚠️ **카드에는 스피커·파형·문장 셋만 있다**(2026-08-24 요청). 그 결과로 사라진 것:
 *   · `word_list` 구분 — 서버가 문장으로 다듬지 못하고 단어를 나열했을 때의 안내 문구와
 *     점선 테두리. 이제 다듬어진 문장과 **구별되지 않는다**.
 *   · 스피커 상태 캡션(준비 중 · 재생 중 · 음성 사용 불가). 준비에 수 초 걸리는 동안
 *     글로는 아무 설명이 없다 — 버튼을 감싸는 링만 남는다.
 */
export function ResultScreen({ phase, onRetry, onReply, onBack }: ResultScreenProps) {
  /**
   * 시안에 후보 목록이 없어 **항상 첫 후보**를 읽는다.
   *
   * ⚠️ 서버가 후보를 여럿 줘도(`candidates`) 사용자가 고를 방법이 사라졌다는 뜻이다.
   * 되살리려면 이 상수를 state 로 되돌리고 카드 아래에 후보 줄을 다시 그리면 된다
   * (git 이력의 `styles.alternatives` 참고).
   */
  const selectedIndex = 0;
  const { v } = useDesignScale();
  /** 한 번이라도 재생됐는지 — 스피커 라벨/캡션이 "재생" 에서 "다시 듣기" 로 바뀐다. */
  const [played, setPlayed] = useState(false);

  const result = phase.name === 'done' ? phase.result : null;
  const selected: SentenceCandidate | null = result?.candidates[selectedIndex] ?? null;

  // 문장이 확정되는 순간(pending → done, 또는 다른 후보 선택) 자동으로 읽는다.
  // 빈 문자열이면 훅이 아무것도 하지 않는다.
  //
  // 감정·말투 태그를 함께 넘긴다 — 서버 TTS 의 연기가 이 값으로 갈린다. 규칙 폴백으로
  // 만들어진 문장이면 null 이고, 그때는 훅이 태그 없이 읽는다(계약상 선택 값).
  const { status, speak, stop } = useSpeech(selected?.text ?? '', {
    emotion: selected?.emotion ?? null,
    style: selected?.style ?? null,
  });
  // 훅 상태를 표현용 union 으로 받는다. 화면은 다섯 상태를 모두 그려야 하고,
  // 훅이 그중 일부만 내보내더라도(부분집합) 그대로 대입된다.
  const speechStatus: SpeakerStatus = status;
  /**
   * 문장 글자 — 시안 실측 Bold 48(460:2694)에 세로 배율을 태운다. 청인에게 보여주는
   * 큰 글자라 바닥값 아래로는 내리지 않고, 그래도 넘치면 카드 안에서 스크롤시킨다.
   */
  const sentenceSize = Math.max(SENTENCE_MIN_FONT_SIZE, v(SENTENCE_FONT_SIZE));
  const waveformLevels = useSpeakingWaveform(speechStatus === 'speaking');

  useEffect(() => {
    if (speechStatus === 'speaking') setPlayed(true);
  }, [speechStatus]);

  const handleSpeakerPress = () => {
    // 재생 중 탭 = 정지. 근거는 SpeakerButton 주석 참고(서버 TTS 재요청 비용 + 무변화 피드백).
    if (speechStatus === 'speaking') stop();
    else speak();
  };

  const body = (
    <>
      {phase.name === 'pending' ? (
        <View style={styles.centerCard} testID="result-composing">
          {/*
            문장 변환은 수 초가 걸린다 — 도는 링이 없으면 "멈췄다"로 읽힌다.
            「동작 줄이기」면 SpinnerRing 이 회전만 멈추고 링은 남긴다. 이 화면에는 아래
            문구가 함께 있지만, 안내를 텍스트에만 기대지 않는다는 원칙대로 도형도 남겨
            글을 읽지 않는 사용자에게도 대기 중이라는 사실이 보이게 한다.
          */}
          <SpinnerRing
            size={COMPOSING_SPINNER_SIZE}
            thickness={COMPOSING_SPINNER_THICKNESS}
            testID="result-composing-spinner"
          />
          <Text style={styles.centerTitle}>{strings.result.composing}</Text>
        </View>
      ) : phase.name === 'failed' ? (
        <View style={styles.centerCard} testID="result-compose-failed">
          <Text style={styles.centerTitle}>{strings.result.composeFailedTitle}</Text>
          <Text style={styles.centerBody}>{strings.result.composeFailedBody}</Text>
        </View>
      ) : selected ? (
        <>
          <View style={styles.card} testID="result-sentence">
            {/* 스피커 = 재생 조작. 상태별 도형·움직임은 SpeakerButton 이 갖는다. */}
            <SpeakerButton
              status={speechStatus}
              onPress={handleSpeakerPress}
              played={played}
              testID="result-speaker"
            />

            {/* 파형 — 장식이다(useSpeakingWaveform 주석). 재생 중에만 움직인다. */}
            <Waveform amplitudes={waveformLevels} testID="result-waveform" />

            {/*
              긴 문장이 스피커·파형을 밀어내지 않도록 스크롤 영역에 담는다 — 카드가
              `flex` 라 그냥 두면 글자가 자란 만큼 위 요소가 잘린다.
            */}
            <ScrollView
              style={styles.sentenceViewport}
              contentContainerStyle={styles.sentenceContent}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[
                  styles.sentence,
                  { fontSize: sentenceSize, lineHeight: sentenceSize * 1.4 },
                  koreanWordBreak,
                ]}
              >
                {selected.text}
              </Text>
            </ScrollView>
          </View>

        </>
      ) : (
        // done 인데 후보가 0개 — 서버 계약상 없어야 하지만 방어한다.
        <View style={styles.centerCard}>
          <Text style={styles.centerTitle}>{strings.result.composeFailedTitle}</Text>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.root}>
      {/*
        시안에 AppBar 가 없다. 상단 인디고 띠의 마이크 손잡이가 곧 「답장」 이다 —
        아이콘(마이크 + 아래 화살촉)이 가리키는 대로 청인 트랙으로 넘어간다.
      */}
      <TrackSwitchHandle
        variant="toVoice"
        onPress={onReply}
        accessibilityLabel={strings.result.reply}
        testID="result-reply"
      />

      <View style={styles.body}>{body}</View>

      <View style={[styles.footer, { paddingVertical: v(spacing.lg), gap: v(spacing.md) }]}>
        {phase.name === 'failed' ? (
          <Button label={strings.result.retryCompose} onPress={onRetry} testID="result-retry" />
        ) : (
          // 시안의 하단 버튼은 「뒤로」 하나다(460:2714). 세션을 끝내는 「처음으로」는
          // 이 화면에서 사라졌다 — 뒤로 간 입력 화면의 손잡이가 그 경로를 갖는다.
          <Button
            label={strings.result.back}
            variant="outline"
            onPress={onBack}
            testID="result-back"
          />
        )}
      </View>
    </View>
  );
}

/** 시안 실측 문장 글자(460:2694)와 그 바닥값. */
const SENTENCE_FONT_SIZE = 48;
const SENTENCE_MIN_FONT_SIZE = 28;

/** 문장 만드는 중 링 — 빈 카드 한가운데 놓이는 대기 표시. */
const COMPOSING_SPINNER_SIZE = 56;
const COMPOSING_SPINNER_THICKNESS = 6;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg.canvas,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    // 세로 여백은 세로 배율을 거쳐 인라인으로 들어온다.
  },
  // 시안에서 이 카드는 본문을 거의 다 채운다(430x932 프레임 기준 398x645).
  card: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.subtle,
  },
  /** 문장이 길 때만 실제로 스크롤된다 — 짧으면 내용 높이만 차지한다. */
  sentenceViewport: {
    alignSelf: 'stretch',
    flexGrow: 0,
    flexShrink: 1,
  },
  sentenceContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  sentence: {
    // 청인에게 보여주는 텍스트 — 큰 글자 · 고대비.
    // 크기·행간은 세로 배율을 거쳐 인라인으로 들어온다(SENTENCE_FONT_SIZE 주석).
    fontFamily: fonts.bold,
    letterSpacing: -0.72,
    color: colors.text.primary,
    textAlign: 'center',
  },
  // 확정 디자인 실측: Regular 20 / 행간 145% (430pt 폭 기준).
  // 대안 문장 행 — CandidateRow 삭제(마스터) 후 시안 아웃라인 톤으로 그린 행.
  centerCard: {
    flex: 1,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
  },
  centerTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 30,
    color: colors.text.primary,
    textAlign: 'center',
  },
  centerBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
