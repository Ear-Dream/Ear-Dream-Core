import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SentenceCandidate } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { Ripple } from '../../components/Ripple';
import { ScreenFrame } from '../../components/ScreenFrame';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type { ComposerPhase } from '../recognition/api/useSentenceComposer';
import type { SessionWord } from '../recognition/session';
import { useSpeech } from './speech';

export interface ResultScreenProps {
  /** 문장을 만든 입력 단어 열 — 문장과 병기해 무엇에서 나온 문장인지 보여준다. */
  words: readonly SessionWord[];
  /** /compose-sentence 호출 상태. pending = 로딩, failed = 재전송 UI. */
  phase: ComposerPhase;
  /** 전송 실패 시 재전송 (단어 열은 보존되어 있다). */
  onRetry: () => void;
  /** "처음으로 돌아가기" — 세션 종료(칩 비움). */
  onGoHome: () => void;
  /** AppBar 뒤로가기 — 입력 화면으로 복귀(칩 유지, 단어 추가·수정 가능). */
  onBack: () => void;
}

/**
 * 음성 전달 화면 (V2 시안 "음성 전달"): brand/subtle 카드 — 스피커 아이콘 + 문장 + 캡션.
 * 문장은 /compose-sentence 결과다(입력 단어 병기 · word_list 구분 · 실패 시 재전송 포함).
 *
 * 문장이 완성되면 실제로 읽는다(웹 SpeechSynthesis). 폰을 든 사람은 그 소리를 듣지
 * 못하므로 "지금 말하고 있어요"를 눈으로도 보여준다 — 소리로만 전달되는 피드백을 만들지
 * 않는다는 원칙이다. 청인이 읽는 문장이라 큰 글자 · 고대비로 렌더링한다.
 *
 * 시안에 있던 파형은 뺐다(마스터 결정 유지). SpeechSynthesis 는 오디오 레벨을 노출하지
 * 않아 재생 중인 소리의 파형을 진짜로 그릴 수 없다. 아무 관계 없는 움직임을 파형인 척
 * 흔드느니, 소리가 나가는 중이라는 사실만 물결로 표시한다.
 *
 * source 구분: `word_list` 는 서버가 문장으로 다듬지 못하고 단어를 그대로 나열한 것이다.
 * 문장처럼 보이면 안 되므로 안내 문구 + 점선 테두리로 시각 구분한다(색에만 의존하지 않는다).
 */
export function ResultScreen({ words, phase, onRetry, onGoHome, onBack }: ResultScreenProps) {
  // 후보가 여럿이면 탭으로 바꿔볼 수 있다. 후보 개수는 서버 몫(미확정)이다.
  const [selectedIndex, setSelectedIndex] = useState(0);

  const result = phase.name === 'done' ? phase.result : null;
  const selected: SentenceCandidate | null =
    result?.candidates[selectedIndex] ?? result?.candidates[0] ?? null;

  // 문장이 확정되는 순간(pending → done, 또는 다른 후보 선택) 자동으로 읽는다.
  // 빈 문자열이면 훅이 아무것도 하지 않는다.
  const { status, speak, error } = useSpeech(selected?.text ?? '');
  const speaking = status === 'speaking';
  const unavailable = status === 'unsupported' || status === 'error';

  return (
    <ScreenFrame
      title={strings.result.appBarTitle}
      onBack={onBack}
      footer={
        phase.name === 'failed' ? (
          <Button label={strings.result.retryCompose} onPress={onRetry} testID="result-retry" />
        ) : (
          <>
            {selected ? (
              <Button
                label={strings.result.replay}
                variant="outline"
                disabled={status === 'unsupported'}
                onPress={speak}
                testID="result-replay"
              />
            ) : null}
            <Button label={strings.result.backToStart} onPress={onGoHome} testID="result-home" />
          </>
        )
      }
    >
      {phase.name === 'pending' ? (
        <View style={styles.centerCard} testID="result-composing">
          <View style={styles.spinner} />
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

            <View style={styles.speakerStage}>
              {/* 스피커 아이콘 — 확정 자산 전 placeholder 도형(인디고 원 + 스피커 모양). */}
              <View style={styles.speakerCircle} accessibilityLabel={strings.result.speakerAlt}>
                <View style={styles.speakerShape}>
                  <View style={styles.speakerBody} />
                  <View style={styles.speakerHorn} />
                </View>
              </View>
              {/* 소리가 나가는 중이라는 표시. 재생이 끝나면 멈춘다. */}
              <Ripple
                size={SPEAKER_RIPPLE_SIZE}
                startScale={SPEAKER_SIZE / SPEAKER_RIPPLE_SIZE}
                active={speaking}
                testID="result-ripple"
              />
            </View>

            <Text style={styles.sentence}>{selected.text}</Text>

            <Text style={[styles.caption, unavailable && styles.captionWarning]}>
              {unavailable
                ? (error ?? strings.result.speechUnavailable)
                : speaking
                  ? strings.result.speaking
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

const SPEAKER_SIZE = 88;
/** 물결이 가장 멀리 퍼졌을 때의 지름. */
const SPEAKER_RIPPLE_SIZE = 176;

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
  speakerStage: {
    width: SPEAKER_RIPPLE_SIZE,
    height: SPEAKER_RIPPLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerCircle: {
    width: SPEAKER_SIZE,
    height: SPEAKER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
  },
  speakerShape: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  speakerBody: {
    width: 10,
    height: 14,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
    backgroundColor: colors.text.onBrand,
  },
  speakerHorn: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderRightWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: colors.text.onBrand,
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
  spinner: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 6,
    borderColor: colors.brand.subtle,
    borderTopColor: colors.brand.primary,
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
