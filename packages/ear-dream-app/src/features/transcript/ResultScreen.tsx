import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SentenceCandidate } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { SpinnerRing } from '../../components/SpinnerRing';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type { ComposerPhase } from '../recognition/api/useSentenceComposer';
import type { SessionWord } from '../recognition/session';
import { useSpeech } from './speech';
import { SpeakerButton, type SpeakerStatus } from './SpeakerButton';

export interface ResultScreenProps {
  /** 문장을 만든 입력 단어 열 — 문장과 병기해 무엇에서 나온 문장인지 보여준다. */
  words: readonly SessionWord[];
  /** /compose-sentence 호출 상태. pending = 로딩, failed = 재전송 UI. */
  phase: ComposerPhase;
  /** 전송 실패 시 재전송 (단어 열은 보존되어 있다). */
  onRetry: () => void;
  /** "답장하기" — 청인 트랙(음성 입력)으로. 세션 종료(칩 비움)를 겸한다. */
  onReply: () => void;
  /** "처음으로 돌아가기" — 세션 종료(칩 비움). */
  onGoHome: () => void;
  /** AppBar 뒤로가기 — 입력 화면으로 복귀(칩 유지, 단어 추가·수정 가능). */
  onBack: () => void;
}

/**
 * 음성 전달 화면 (V2 시안 "음성 전달"): brand/subtle 카드 — 스피커 아이콘 + 문장 + 캡션.
 * 문장은 /compose-sentence 결과다(입력 단어 병기 · word_list 구분 · 실패 시 재전송 포함).
 *
 * 문장이 완성되면 실제로 읽는다. 폰을 든 사람은 그 소리를 듣지 못하므로 "지금 말하고
 * 있어요"를 눈으로도 보여준다 — 소리로만 전달되는 피드백을 만들지 않는다는 원칙이다.
 * 청인이 읽는 문장이라 큰 글자 · 고대비로 렌더링한다.
 *
 * 재생 조작은 스피커 아이콘 자체가 맡는다(SpeakerButton). 아이콘이 소리를 뜻하는 자리에
 * 있으면서 장식이기만 하면, 눌러본 사람은 고장으로 받아들인다. 하단 버튼 자리는
 * "답장하기"(청인 트랙으로 넘어가기)가 가져갔다 — 문장을 들려준 다음의 실제 다음 행동이다.
 *
 * 시안에 있던 파형은 뺐다(마스터 결정 유지). 재생 엔진이 오디오 레벨을 노출하지 않아
 * 재생 중인 소리의 파형을 진짜로 그릴 수 없다. 아무 관계 없는 움직임을 파형인 척
 * 흔드느니, 소리가 나가는 중이라는 사실만 물결로 표시한다.
 *
 * source 구분: `word_list` 는 서버가 문장으로 다듬지 못하고 단어를 그대로 나열한 것이다.
 * 문장처럼 보이면 안 되므로 안내 문구 + 점선 테두리로 시각 구분한다(색에만 의존하지 않는다).
 */
export function ResultScreen({
  words,
  phase,
  onRetry,
  onReply,
  onGoHome,
  onBack,
}: ResultScreenProps) {
  // 후보가 여럿이면 탭으로 바꿔볼 수 있다. 후보 개수는 서버 몫(미확정)이다.
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** 한 번이라도 재생됐는지 — 스피커 라벨/캡션이 "재생" 에서 "다시 듣기" 로 바뀐다. */
  const [played, setPlayed] = useState(false);

  const result = phase.name === 'done' ? phase.result : null;
  const selected: SentenceCandidate | null =
    result?.candidates[selectedIndex] ?? result?.candidates[0] ?? null;

  // 문장이 확정되는 순간(pending → done, 또는 다른 후보 선택) 자동으로 읽는다.
  // 빈 문자열이면 훅이 아무것도 하지 않는다.
  //
  // 감정·말투 태그를 함께 넘긴다 — 서버 TTS 의 연기가 이 값으로 갈린다. 규칙 폴백으로
  // 만들어진 문장이면 null 이고, 그때는 훅이 태그 없이 읽는다(계약상 선택 값).
  const { status, speak, stop, error } = useSpeech(selected?.text ?? '', {
    emotion: selected?.emotion ?? null,
    style: selected?.style ?? null,
  });
  // 훅 상태를 표현용 union 으로 받는다. 화면은 다섯 상태를 모두 그려야 하고,
  // 훅이 그중 일부만 내보내더라도(부분집합) 그대로 대입된다.
  const speechStatus: SpeakerStatus = status;
  const unavailable = speechStatus === 'unsupported' || speechStatus === 'error';

  useEffect(() => {
    if (speechStatus === 'speaking') setPlayed(true);
  }, [speechStatus]);

  const handleSpeakerPress = () => {
    // 재생 중 탭 = 정지. 근거는 SpeakerButton 주석 참고(서버 TTS 재요청 비용 + 무변화 피드백).
    if (speechStatus === 'speaking') stop();
    else speak();
  };

  return (
    <ScreenFrame
      title={strings.result.appBarTitle}
      onBack={onBack}
      footer={
        phase.name === 'failed' ? (
          <Button label={strings.result.retryCompose} onPress={onRetry} testID="result-retry" />
        ) : (
          // 아래쪽일수록 엄지에 가깝다. 문장을 전달한 다음의 주 행동인 "답장하기"를 맨 아래
          // primary 로 두고, 세션을 끝내는 "처음으로"는 그 위 outline 으로 내린다.
          // 답장하기는 문장이 나온 뒤에만 뜬다 — 만드는 중에는 아직 전달된 게 없다.
          <>
            <Button
              label={strings.result.backToStart}
              variant="outline"
              onPress={onGoHome}
              testID="result-home"
            />
            {selected ? (
              <Button label={strings.result.reply} onPress={onReply} testID="result-reply" />
            ) : null}
          </>
        )
      }
    >
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
          <View
            style={[styles.card, selected.source === 'word_list' && styles.cardWordList]}
            testID="result-sentence"
          >
            {selected.source === 'word_list' ? (
              <Text style={styles.wordListNotice} testID="result-word-list-notice">
                {strings.result.wordListNotice}
              </Text>
            ) : null}

            {/* 스피커 = 재생 조작. 상태별 도형·움직임은 SpeakerButton 이 갖는다. */}
            <SpeakerButton
              status={speechStatus}
              onPress={handleSpeakerPress}
              played={played}
              testID="result-speaker"
            />

            <Text style={styles.sentence}>{selected.text}</Text>

            {/*
              캡션은 스피커 상태를 글로도 말해 준다. 특히 준비 중(수 초)은 링만으로 두면
              "눌렀는데 아무 일도 안 일어난다"로 읽힌다.
            */}
            <Text style={[styles.caption, unavailable && styles.captionWarning]}>
              {unavailable
                ? (error ?? strings.result.speechUnavailable)
                : speechStatus === 'loading'
                  ? strings.result.preparing
                  : speechStatus === 'speaking'
                    ? strings.result.speaking
                    : played
                      ? strings.result.tapToReplay
                      : strings.result.caption}
            </Text>
          </View>

          {/* 입력 단어 병기 — 어떤 단어에서 나온 문장인지 항상 보인다(정정 판단 근거). */}
          <View style={styles.wordsRow} testID="result-input-words">
            <Text style={styles.wordsLabel}>{strings.result.inputWordsLabel}</Text>
            <Text style={styles.wordsText}>{words.map((word) => word.label).join(' · ')}</Text>
          </View>

          {result && result.candidates.length > 1 ? (
            <View style={styles.alternatives}>
              <Text style={styles.wordsLabel}>{strings.result.alternativesLabel}</Text>
              {result.candidates.map((candidate, index) =>
                index === selectedIndex ? null : (
                  <Pressable
                    key={`${candidate.text}-${index}`}
                    onPress={() => setSelectedIndex(index)}
                    accessibilityRole="button"
                    accessibilityLabel={candidate.text}
                    style={({ pressed }) => [
                      styles.alternativeRow,
                      pressed && styles.alternativeRowPressed,
                    ]}
                    testID={`result-alternative-${index}`}
                  >
                    <Text style={styles.alternativeText}>{candidate.text}</Text>
                  </Pressable>
                ),
              )}
            </View>
          ) : null}
        </>
      ) : (
        // done 인데 후보가 0개 — 서버 계약상 없어야 하지만 방어한다.
        <View style={styles.centerCard}>
          <Text style={styles.centerTitle}>{strings.result.composeFailedTitle}</Text>
        </View>
      )}
    </ScreenFrame>
  );
}

/** 문장 만드는 중 링 — 빈 카드 한가운데 놓이는 대기 표시. */
const COMPOSING_SPINNER_SIZE = 56;
const COMPOSING_SPINNER_THICKNESS = 6;

const styles = StyleSheet.create({
  card: {
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
  // word_list 시각 구분: 점선 테두리 + 중립 배경 — "다듬어진 문장" 카드와 형태로도 갈린다.
  cardWordList: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border.default,
    backgroundColor: colors.bg.surface,
  },
  wordListNotice: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  sentence: {
    // 청인에게 보여주는 텍스트 — 큰 글자 · 고대비.
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 40,
    color: colors.text.primary,
    textAlign: 'center',
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  captionWarning: {
    color: colors.status.error,
  },
  wordsRow: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  wordsLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.text.secondary,
  },
  wordsText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text.primary,
  },
  alternatives: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  // 대안 문장 행 — CandidateRow 삭제(마스터) 후 시안 아웃라인 톤으로 그린 행.
  alternativeRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  alternativeRowPressed: {
    opacity: 0.85,
  },
  alternativeText: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text.primary,
  },
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
