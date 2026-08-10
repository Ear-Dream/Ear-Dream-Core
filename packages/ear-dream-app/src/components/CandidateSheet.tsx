import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { CANDIDATE_CELL_SIZE, CandidateCard } from './CandidateCard';
import { MOCK_CANDIDATE_WORDS, type MockCandidateWord } from '../constants/mock';
import { strings } from '../constants/strings';
import { colors, fonts, radius, spacing } from '../constants/theme';

export interface CandidateSheetProps {
  visible: boolean;
  /** 후보 선택 확정 — 음성 전달 화면으로. */
  onConfirm: (candidate: MockCandidateWord) => void;
  /** 취소하고 다시 찍기. 카메라는 살아 있으므로 재획득 없이 촬영 상태로 되돌린다. */
  onRetake: () => void;
}

const SHEET_ANIM_MS = 220;

/** 시안이 2×2 그리드다. 후보 개수 N 이 바뀌어도 열 수는 여기서만 정한다. */
const GRID_COLUMNS = 2;

/**
 * 후보 단어 선택 시트 (V2 시안 "단어 선택").
 *
 * 라우트가 아니라 인식 화면 위에 얹는 오버레이다. 카메라 프리뷰가 시트 뒤에서 계속
 * 살아 있어야 "취소하고 다시 찍기"가 즉시 동작하고, AppBar도 "수어 인식 중" 그대로 둔다.
 * 후보는 목업이며 개수 N 도 미확정이다(mock.ts).
 */
export function CandidateSheet({ visible, onConfirm, onRetake }: CandidateSheetProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = MOCK_CANDIDATE_WORDS.find((c) => c.id === selectedId) ?? null;
  const progress = useRef(new Animated.Value(0)).current;

  // 새 인식 결과가 들어오면 이전 선택을 반드시 버린다.
  useEffect(() => {
    if (!visible) setSelectedId(null);
  }, [visible]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: SHEET_ANIM_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [visible, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: progress }]} pointerEvents="none" />

      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View style={styles.grabber} />
        <Text style={styles.prompt}>{strings.candidates.prompt}</Text>

        <View style={styles.grid}>
          {MOCK_CANDIDATE_WORDS.map((candidate, index) => (
            <CandidateCard
              key={candidate.id}
              word={candidate.word}
              iconKey={candidate.iconKey}
              selected={candidate.id === selectedId}
              onPress={() => setSelectedId(candidate.id)}
              testID={`candidates-card-${index}`}
            />
          ))}
        </View>

        <Button
          label={strings.candidates.confirm}
          disabled={selected == null}
          onPress={() => {
            if (selected != null) onConfirm(selected);
          }}
          testID="candidates-confirm"
        />

        <Pressable
          onPress={onRetake}
          accessibilityRole="button"
          testID="candidates-retake"
          style={({ pressed }) => [styles.retake, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.retakeLabel}>{strings.candidates.retake}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // RN 0.86 타입에는 absoluteFillObject 가 없다. 값이 같으므로 그대로 적는다
  // (SignInputScreen 의 오버레이 스타일도 같은 방식이다).
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(17, 19, 24, 0.35)',
  },
  sheet: {
    backgroundColor: colors.bg.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border.default,
  },
  prompt: { fontFamily: fonts.bold, fontSize: 20, color: colors.text.primary },
  grid: {
    // 2열 고정. 폭을 열어 두면 시트가 넓을 때 flexWrap 이 한 줄에 3개까지 밀어넣어
    // 3 + 1 로 접힌다. 두 칸 + 사이 간격만큼으로 잘라 두 번째 카드 뒤에서 반드시 접히게 한다.
    alignSelf: 'center',
    width: CANDIDATE_CELL_SIZE * GRID_COLUMNS + spacing.md * (GRID_COLUMNS - 1),
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  retake: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retakeLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.brand.accent },
});