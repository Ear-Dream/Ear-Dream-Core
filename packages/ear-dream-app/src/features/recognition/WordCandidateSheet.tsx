import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { QualityIssue } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { CandidateRow } from '../../components/CandidateRow';
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

/**
 * 확정 pill 탭 → 하단 시트: 그 단어의 top-k 후보 목록(탭=교체) + 삭제 + 닫기.
 *
 * 오확정 정정이 pill 탭 → 후보 탭, 총 2회로 끝난다(PRD R-05 "2단계 이내").
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
            <Text style={styles.prompt}>{strings.wordSheet.prompt}</Text>
            {hint ? (
              <Text style={styles.advisoryHint} testID="word-sheet-advisory-hint">
                {hint}
              </Text>
            ) : null}
            <View style={styles.list}>
              {entry.result.candidates.map((candidate, index) => (
                <CandidateRow
                  key={candidate.id}
                  sentence={candidate.label}
                  selected={index === entry.chosenCandidateIndex}
                  onPress={() => onChoose(index)}
                  testID={`word-sheet-candidate-${index}`}
                />
              ))}
            </View>
            <View style={styles.actions}>
              <Button
                label={strings.wordSheet.removeWord}
                variant="outline"
                onPress={onRemove}
                testID="word-sheet-remove"
              />
              <Button label={strings.wordSheet.close} onPress={onClose} testID="word-sheet-close" />
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
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.bg.canvas,
  },
  prompt: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.text.primary,
  },
  // 어드바이저리 힌트 — 안내이지 실패가 아니므로 보조 톤(secondary)으로만 그린다.
  advisoryHint: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
  },
  list: {
    gap: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
