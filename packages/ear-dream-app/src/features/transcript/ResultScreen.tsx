import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { SentenceCandidate } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { CandidateRow } from '../../components/CandidateRow';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Waveform } from '../../components/Waveform';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type { ComposerPhase } from '../recognition/api/useSentenceComposer';
import type { SessionWord } from '../recognition/session';

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
 * 음성 전달 화면 — 조립한 단어 열로 만든 문장을 청인에게 보여준다.
 *
 * TTS 는 미구현이므로 "전달되고 있어요"는 표시일 뿐이다. 파형도 정적 mock 이다.
 * 청인이 보는 화면이므로 문장은 큰 글자 · 고대비로 렌더링한다.
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

  return (
    <ScreenFrame
      title={strings.result.appBarTitle}
      onBack={onBack}
      footer={
        phase.name === 'failed' ? (
          <Button label={strings.result.retryCompose} onPress={onRetry} testID="result-retry" />
        ) : (
          <Button label={strings.result.backToStart} onPress={onGoHome} testID="result-home" />
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
            ) : (
              <Waveform testID="result-waveform" />
            )}
            <Text style={styles.sentence}>{selected.text}</Text>
            {selected.source !== 'word_list' ? (
              <Text style={styles.caption}>{strings.result.caption}</Text>
            ) : null}
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
                  <CandidateRow
                    key={`${candidate.text}-${index}`}
                    sentence={candidate.text}
                    selected={false}
                    onPress={() => setSelectedIndex(index)}
                    testID={`result-alternative-${index}`}
                  />
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
