import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { QualityIssue } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { CANDIDATE_CELL_WIDTH, CandidateCard } from '../../components/CandidateCard';
import { strings } from '../../constants/strings';
import { colors, fonts, maxScreenWidth, radius, spacing } from '../../constants/theme';
import type { RecognitionEntry } from './api/useRecognitionQueue';

export interface WordCandidateSheetProps {
  /** 열려 있는 대상 done 엔트리. null 이면 닫힌 상태다. */
  entry: Extract<RecognitionEntry, { state: 'done' }> | null;
  /** 후보 탭 = 교체 확정. 닫기는 호출한 쪽이 함께 처리한다. */
  onChoose: (index: number) => void;
  /** "이 단어 지우기" — 엔트리 제거. */
  onRemove: () => void;
  onClose: () => void;
}

/** 시안(V2 "단어 선택")이 2×2 그리드다. 후보 개수 N 이 바뀌어도 열 수는 여기서만 정한다. */
const GRID_COLUMNS = 2;

/**
 * 확정 pill 탭 → 하단 시트: 그 단어의 top-k 후보 그리드(탭=교체) + 삭제 + 닫기.
 * 카드 그리드 비주얼은 V2 시안 "단어 선택" 프레임을 따른다. 시안의 "선택 → 확정 버튼"
 * 2단계 대신 카드 탭 즉시 교체를 유지한다 — 오확정 정정이 pill 탭 → 후보 탭, 총 2회로
 * 끝나야 해서다(PRD R-05 "2단계 이내").
 *
 * 자체 구현(RN Modal) — 새 의존성 금지 방침. 시트·버튼 전부 화면 하단, 엄지 범위다.
 *
 * 시트가 열린 동안 캡처는 비활성이다 — Modal 이 아래 화면 터치를 자연히 가로막는다.
 * "시트 열림 중에도 캡처 유지"가 이상이지만, hold-to-record 와 시트 터치의 제스처 경합을
 * 피하는 단순화를 택했다(허용된 트레이드오프). 시트는 스크림 탭·닫기 버튼으로 즉시 닫힌다.
 *
 * 후보에 confidence 수치는 표시하지 않는다(PRD V-07 미확정) — 정렬 순서가 곧 우열이다.
 */
export function WordCandidateSheet({ entry, onChoose, onRemove, onClose }: WordCandidateSheetProps) {
  const hint = entry ? advisoryHint(entry.result.quality_issues) : null;
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.wordSheet.close}
          onPress={onClose}
          style={styles.scrim}
          testID="word-sheet-scrim"
        />
        {entry ? (
          <View style={styles.sheet} testID="word-sheet">
            <View style={styles.grabber} />
            <Text style={styles.prompt}>{strings.wordSheet.prompt}</Text>
            {hint ? (
              <Text style={styles.advisoryHint} testID="word-sheet-advisory-hint">
                {hint}
              </Text>
            ) : null}
            <View style={styles.grid}>
              {entry.result.candidates.map((candidate, index) => (
                <CandidateCard
                  key={candidate.id}
                  word={candidate.label}
                  iconKey={candidate.label}
                  selected={index === entry.chosenCandidateIndex}
                  onPress={() => onChoose(index)}
                  testID={`word-sheet-candidate-${index}`}
                />
              ))}
            </View>
            {/*
              시안의 시트 하단 버튼은 「다시 하기」 하나다(473:1326). 닫기 버튼이 없어져
              **스크림 탭이 유일한 닫기 경로**가 된다 — 스크림에는 이미 같은 라벨의
              accessibilityLabel 이 붙어 있다.
            */}
            <View style={styles.actions}>
              <Button
                label={strings.wordSheet.removeWord}
                variant="outline"
                onPress={onRemove}
                testID="word-sheet-remove"
              />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * recognized 와 함께 온 어드바이저리 quality_issues → 힌트 한 줄. 여러 개여도 첫 번째로
 * 매핑되는 것 하나만 쓴다. 서버가 새 값을 추가하면 advisoryFallback 으로 표시된다.
 * (구 CandidateScreen 에서 옮겨 온 로직 — 후보 화면이 시트로 대체되면서 함께 이동.)
 */
function advisoryHint(issues: QualityIssue[] | undefined): string | null {
  if (!issues || issues.length === 0) return null;
  for (const issue of issues) {
    const hint = strings.wordSheet.advisoryHints[issue];
    if (hint) return hint;
  }
  return strings.wordSheet.advisoryFallback;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(11, 15, 20, 0.45)',
  },
  sheet: {
    width: '100%',
    // 웹에서 화면 폭이 넓어도 시트는 본문(ScreenFrame)과 같은 폭으로 하단 중앙에 붙는다.
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    // 시안 실측: 상단 모서리 26 · bg/card (460:2508).
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.bg.card,
  },
  // 시안 실측: 44x5 · line/soft (460:2509).
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border.soft,
  },
  // 시안 실측: Bold 40 / 행간 135% / 자간 -0.8 / text/strong (460:2510).
  prompt: {
    fontFamily: fonts.bold,
    fontSize: 40,
    lineHeight: 40 * 1.35,
    letterSpacing: -0.8,
    color: colors.text.strong,
    textAlign: 'center',
  },
  // 어드바이저리 힌트 — 안내이지 실패가 아니므로 보조 톤(secondary)으로만 그린다.
  advisoryHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
  },
  grid: {
    // 2열 고정. 폭을 열어 두면 시트가 넓을 때 flexWrap 이 한 줄에 3개까지 밀어넣어
    // 3 + 1 로 접힌다. 두 칸 + 사이 간격만큼으로 잘라 두 번째 카드 뒤에서 반드시 접히게 한다.
    alignSelf: 'center',
    width: CANDIDATE_CELL_WIDTH * GRID_COLUMNS + spacing.lg * (GRID_COLUMNS - 1),
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
