import { Pressable, StyleSheet, Text, View } from 'react-native';

import { candidateIconFor } from '../../components/icons/CandidateIcons';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';
import type { RecognitionEntry } from './api/useRecognitionQueue';
import { chosenCandidate } from './api/useRecognitionQueue';

export interface QueuePillProps {
  entry: RecognitionEntry;
  /**
   * pill 본체 탭 — 상태별 의미가 다르다:
   *   pending → 취소(엔트리 제거), done → 하단 시트 열기, failed → 그 단어만 재전송.
   * 세 경우 모두 탭 1회다 (한 손 조작 · PRD R-05 "2단계 이내" 정정).
   */
  onPress: () => void;
  /** failed 전용 — × 탭으로 엔트리를 지운다. 재전송하지 않고 포기하는 경로. */
  onRemove?: () => void;
  /**
   * 지금 하단 시트가 열려 있는 pill 인가. 시안은 이 하나만 brand 톤으로 띄우고
   * 나머지는 흰 칩으로 둔다(460:2767 vs 460:2777).
   */
  selected?: boolean;
  testID?: string;
}

/**
 * 인식 큐의 pill 하나. 태그 입력 UI 의 태그처럼 서버 응답이 순차 누적된다.
 *
 * 상태는 색에만 의존하지 않고 형태로도 갈린다(농인 사용자 접근성 원칙):
 *   pending — 점선 테두리 + "…", done — 실선 brand + 단어 + ▾(시트 열림 표시),
 *   failed — 빨강 테두리 + ↻ 재전송 + 별도 × 타겟.
 *
 * confidence 수치는 표시하지 않는다 — 캘리브레이션되지 않은 수치 노출은 PRD V-07
 * 미해결 항목이다. 후보 간 우열은 하단 시트의 정렬 순서로만 표현한다.
 */
export function QueuePill({ entry, onPress, onRemove, selected = false, testID }: QueuePillProps) {
  if (entry.state === 'pending') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.signInput.pillPendingA11y}
        onPress={onPress}
        style={({ pressed }) => [styles.root, styles.pending, pressed && styles.pressed]}
        testID={testID}
      >
        <Text style={styles.pendingLabel}>{strings.signInput.pillPendingLabel}</Text>
      </Pressable>
    );
  }

  if (entry.state === 'failed') {
    return (
      <View style={[styles.root, styles.failed]} testID={testID}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.signInput.pillFailedA11y}
          onPress={onPress}
          style={({ pressed }) => [styles.failedBody, pressed && styles.pressed]}
          testID={testID ? `${testID}-retry` : undefined}
        >
          <Text style={styles.failedGlyph}>↻</Text>
          <Text style={styles.failedLabel}>{strings.signInput.pillFailedLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.signInput.pillFailedRemoveA11y}
          onPress={onRemove}
          // pill 높이(48)만큼 세로는 확보되고, 가로는 hitSlop 으로 최소 타겟을 보강한다.
          hitSlop={{ left: 8, right: 12, top: 8, bottom: 8 }}
          style={({ pressed }) => [styles.removeZone, pressed && styles.pressed]}
          testID={testID ? `${testID}-remove` : undefined}
        >
          <View style={styles.removeMark}>
            <Text style={styles.removeGlyph}>×</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  const candidate = chosenCandidate(entry);
  // 시안의 단어 칩은 그림 + 글자다. 그림이 없는 단어는 글자만 나온다(추상어 등).
  const Icon = candidateIconFor(candidate.label);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${candidate.label} ${strings.signInput.pillDoneA11ySuffix}`}
      onPress={onPress}
      style={({ pressed }) => [styles.root, styles.done, selected && styles.doneSelected, pressed && styles.pressed]}
      testID={testID}
    >
      {Icon ? <Icon size={PILL_ICON_SIZE} color={colors.text.primary} /> : null}
      <Text style={styles.doneLabel}>{candidate.label}</Text>
      {/* 탭하면 아래(시트)가 열린다는 방향 표시 — 삭제(×)로 오해되지 않게 ▾를 쓴다. */}
      <Text style={styles.doneAffordance}>▾</Text>
    </Pressable>
  );
}

/** 칩 안 픽토그램 — 글자(Bold 28)와 광학적으로 맞는 크기. */
const PILL_ICON_SIZE = 30;

const styles = StyleSheet.create({
  // 시안 실측: 높이 63 · 반경 12 · 테두리 2 (460:2767·460:2777).
  root: {
    minHeight: Math.max(touchTarget.minHeight, 63),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  // pending — 아직 단어가 아니다. 점선 + 중립 톤으로 "빈 자리" 를 표현한다.
  pending: {
    minWidth: 64,
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderColor: colors.border.default,
    backgroundColor: colors.bg.surface,
  },
  pendingLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    letterSpacing: 2,
    color: colors.text.secondary,
  },
  // 확정 칩의 평상시 모습 — 흰 면 + 중립 테두리.
  done: {
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
  },
  /** 하단 시트가 열려 있는 칩만 brand 톤으로 띄운다. */
  doneSelected: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.subtle,
  },
  // 시안 실측: Bold 28 / 행간 140% / 자간 -0.42.
  doneLabel: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 28 * 1.4,
    letterSpacing: -0.42,
    color: colors.text.primary,
  },
  doneAffordance: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.brand.primary,
  },
  // failed — 전송 실패(인식 실패 아님). 본체 = 재전송, × = 포기. 두 타겟을 분리한다.
  failed: {
    paddingHorizontal: 0,
    borderColor: colors.status.error,
    backgroundColor: colors.status.errorSubtle,
  },
  failedBody: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  failedGlyph: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.status.error,
  },
  failedLabel: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.status.error,
  },
  removeZone: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  removeMark: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.status.error,
  },
  removeGlyph: {
    fontFamily: fonts.bold,
    fontSize: 12,
    lineHeight: 14,
    color: colors.text.onBrand,
  },
});
