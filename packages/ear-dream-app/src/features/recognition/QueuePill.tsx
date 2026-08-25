import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WordIcon } from '../../components/WordIcon';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
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
  /**
   * 칩 기하의 세로 배율(`useDesignScale().vScale`). 시안 실측 높이 63.2 가 이 값으로
   * 환산된다 — 짧은 화면에서 단어 띠가 얇아질 때 칩만 원래 크기로 남아 띠를 뚫는 것을
   * 막는다. 부모(`SignInputScreen`)가 이미 계산한 값을 내려받는다 — 칩마다 창 크기를
   * 구독하면 pill 이 늘어날수록 구독도 늘어난다.
   *
   * ⚠️ 글자 크기는 환산하지 않는다. 그래서 배율이 아주 작으면 `minHeight` 대신 글자가
   * 높이를 정한다 — 비율이 조금 어긋나더라도 단어가 잘리지 않는 쪽이다.
   */
  sizeScale?: number;
  testID?: string;
}

/**
 * 인식 큐의 pill 하나. 태그 입력 UI 의 태그처럼 서버 응답이 순차 누적된다.
 *
 * 상태는 색에만 의존하지 않고 형태로도 갈린다(농인 사용자 접근성 원칙):
 *   pending — 점선 테두리 + "…", done — 실선 테두리 + 픽토그램 + 단어,
 *   failed — 빨강 테두리 + ↻ 재전송 + 별도 × 타겟.
 *
 * ⚠️ done 칩에 있던 ▾(하단 시트가 열린다는 방향 표시)는 사용자 요청(2026-08-25)으로
 * 뺐다. 탭하면 시트가 열린다는 사실은 이제 화면에 표시가 없다 — 정정 경로를 처음
 * 발견하기 어려워졌다는 뜻이라, 온보딩이나 첫 사용 안내가 그 몫을 맡아야 한다.
 *
 * confidence 수치는 표시하지 않는다 — 캘리브레이션되지 않은 수치 노출은 PRD V-07
 * 미해결 항목이다. 후보 간 우열은 하단 시트의 정렬 순서로만 표현한다.
 */
export function QueuePill({
  entry,
  onPress,
  onRemove,
  selected = false,
  sizeScale = 1,
  testID,
}: QueuePillProps) {
  const pillHeight = PILL_HEIGHT * sizeScale;
  if (entry.state === 'pending') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.signInput.pillPendingA11y}
        onPress={onPress}
        style={({ pressed }) => [
          styles.root,
          styles.pending,
          { minHeight: pillHeight },
          pressed && styles.pressed,
        ]}
        testID={testID}
      >
        <Text style={styles.pendingLabel}>{strings.signInput.pillPendingLabel}</Text>
      </Pressable>
    );
  }

  if (entry.state === 'failed') {
    return (
      <View style={[styles.root, styles.failed, { minHeight: pillHeight }]} testID={testID}>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${candidate.label} ${strings.signInput.pillDoneA11ySuffix}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        styles.done,
        { minHeight: pillHeight },
        selected && styles.doneSelected,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      {/* 시안의 단어 칩은 그림 + 글자다. 그림은 단어 ID 로 찾는다(WordIcon 주석). */}
      <WordIcon wordId={candidate.id} size={PILL_ICON_SIZE * sizeScale} />
      <Text style={styles.doneLabel}>{candidate.label}</Text>
    </Pressable>
  );
}

/** 시안 실측 칩 높이(63.2)와 좌우 여백(4). */
const PILL_HEIGHT = 63.2;
const PILL_PADDING_X = 4;
/** 칩 안 픽토그램 — 글자(Bold 28) 높이에 맞춘다. 시안 칩에는 그림이 없어 실측값이 아니다. */
const PILL_ICON_SIZE = 28;

const styles = StyleSheet.create({
  /**
   * 시안 실측(460:2767·460:2777): 높이 63.2 · 반경 12 · 테두리 2 ·
   * **좌우 여백 4** (자동차 칩 96 안에 글자 88).
   *
   * 여백이 이렇게 좁은 건 글자가 Bold 28 로 크기 때문이다. 12 를 주면 칩이 시안보다
   * 1.3배 넓어져 두세 개만 담겨도 스트립이 꽉 찬다. 높이 63 이 최소 터치 타깃(48)을
   * 넉넉히 넘으므로 좁은 좌우 여백이 조작성을 해치지도 않는다.
   */
  root: {
    // 높이는 sizeScale 로 환산해 인라인으로 준다(위 props 주석).
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: PILL_PADDING_X,
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
