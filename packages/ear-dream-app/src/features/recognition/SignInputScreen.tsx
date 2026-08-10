import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CandidateSheet } from '../../components/CandidateSheet';
import { CircleIconButton } from '../../components/CircleIconButton';
import { ScreenFrame } from '../../components/ScreenFrame';
import { SelectedWordStrip } from '../../components/SelectedWordStrip';
import { HAND_LOST_OVERLAY_DELAY_MS, type MockCandidateWord } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type { SignCameraDetectionState } from './SignCameraView';
import { SignCameraView } from './SignCameraView';

/**
 * 'candidates' 는 별도 라우트가 아니라 이 화면의 한 단계다. 후보 시트가 뜨는 동안에도
 * 카메라를 그대로 두어야 "취소하고 다시 찍기"가 재획득 없이 즉시 동작한다.
 */
export type SignInputPhase = 'recording' | 'candidates';

/**
 * 지금까지 고른 단어들과 그 조작. 촬영 → 선택을 반복하는 동안 쌓이므로 목록의 주인은
 * 이 화면이 아니라 흐름(AppNavigator)이다 — 인식 중 화면을 거치며 이 화면이 언마운트된다.
 */
export interface SelectedWords {
  items: readonly MockCandidateWord[];
  /** 후보 시트에서 단어 확정 — 목록 끝에 더하고 촬영으로 되돌아간다. */
  onAdd: (candidate: MockCandidateWord) => void;
  /** 칩의 × — 그 자리의 단어를 뺀다(같은 단어가 여러 번 들어올 수 있어 위치로 지운다). */
  onRemove: (index: number) => void;
  /** "결과 확인" — 모은 단어로 문장 화면으로 넘어간다. */
  onComplete: () => void;
}

export interface SignInputScreenProps {
  phase: SignInputPhase;
  words: SelectedWords;
  /** 정지 버튼 — 수어 인식 중 화면으로 진행. */
  onStop: () => void;
  /** 후보 시트에서 취소 — 촬영 상태로 되돌린다. */
  onRetake: () => void;
  onBack: () => void;
}

/**
 * 수어 입력 화면 (V2 시안 "수어 입력"): 다크 뷰파인더 카드 + 녹화 배지 + 가이드 박스 +
 * 하단 정지 버튼.
 *
 * 후보 선택(시안 "단어 선택")은 별도 화면이 아니라 이 화면의 `phase === 'candidates'` 단계다.
 * 시트가 뜨는 동안 카메라를 살려 두어야 "취소하고 다시 찍기"가 재획득 없이 즉시 동작한다.
 * 그 단계에서는 녹화 배지·가이드·하단 정지 버튼을 걷고 시트에 조작을 넘긴다.
 *
 * 한 번에 한 단어씩 찍는다: 촬영 → 정지 → 인식 → 후보에서 단어 선택 → 다시 촬영. 고른 단어는
 * 하단 스트립에 쌓이고 "결과 확인"으로 문장 화면으로 넘어간다. 그래서 이 화면은 한 번 쓰고
 * 버리는 화면이 아니라 문장을 다 만들 때까지 계속 돌아오는 자리다.
 *
 * 인식 실패 예외 (시안 "3번 인식 실패 예외"): 시안 프레임명은 3회 실패지만 실패 카운트는
 * 인식이 미구현이라 만들 수 없다. 그때까지는 손 미검출이 일정 시간(임시값, mock.ts) 지속되면
 * 이 상태로 전환하는 mock 트리거를 쓴다 — 카드가 연빨강 배경 + 빨간 테두리로 바뀌고
 * "다시 촬영하기"로 복귀한다.
 */
export function SignInputScreen({
  phase,
  words,
  onStop,
  onRetake,
  onBack,
}: SignInputScreenProps) {
  const [detection, setDetection] = useState<SignCameraDetectionState>({
    status: 'idle',
    handCount: 0,
    error: null,
  });
  const [handLost, setHandLost] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const recording = phase === 'recording';

  // 촬영 상태로 돌아오면(첫 진입 · 다시 찍기) 이전 회차의 흔적을 지운다.
  useEffect(() => {
    if (recording) {
      setHandLost(false);
      setRecordSeconds(0);
    }
  }, [recording]);

  useEffect(() => {
    if (!recording || detection.status !== 'running' || detection.handCount > 0) {
      setHandLost(false);
      return;
    }
    // 한두 프레임 검출 누락에 화면이 깜빡이지 않게 지연을 둔다(임시값, mock.ts 참고).
    const timer = setTimeout(() => setHandLost(true), HAND_LOST_OVERLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [recording, detection.status, detection.handCount]);

  // 녹화 타이머는 mock 이다 — 실제 녹화/버퍼링은 없고 배지 표시용으로만 센다(T-08 이전).
  useEffect(() => {
    if (!recording || handLost) return;
    const interval = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recording, handLost]);

  // 두 손 검출 상태 표시 — useLandmarker 의 검출 결과를 표시에만 쓴다(가공·버퍼링 없음).
  const handsVisible = detection.status === 'running' && detection.handCount >= 2;

  return (
    <ScreenFrame
      // 후보 시트가 뜬 동안에는 인식 결과를 보는 단계라 AppBar 제목도 그에 맞춘다.
      title={recording ? strings.signInput.appBarTitle : strings.candidates.appBarTitle}
      // 후보 단계의 뒤로가기는 촬영으로 되돌린다 — 여기서 첫 화면까지 나가면 방금 찍은 걸 잃는다.
      onBack={recording ? onBack : onRetake}
      // 시트가 자기 조작(확정 · 다시 찍기)을 들고 있으므로 시트 단계에서는 하단 조작을 비운다.
      // 촬영 단계에서는 모은 단어 스트립을 정지 버튼 위에 항상 둔다 — 오인식 정정(칩의 ×)은
      // 숨은 메뉴에 두지 않는다.
      footer={
        !recording ? null : (
          <>
            <SelectedWordStrip
              items={words.items}
              onRemove={words.onRemove}
              onComplete={words.onComplete}
              testID="sign-input-words"
            />
            {handLost ? (
              <Button
                label={strings.signInput.retake}
                variant="outline"
                onPress={() => {
                  setHandLost(false);
                  setRecordSeconds(0);
                }}
                testID="sign-input-retake"
              />
            ) : (
              <View style={styles.stopRow}>
                <CircleIconButton
                  onPress={onStop}
                  accessibilityLabel={strings.signInput.stopAlt}
                  size={64}
                  style={styles.stopButton}
                  testID="sign-input-stop"
                >
                  <View style={styles.stopSquare} />
                </CircleIconButton>
              </View>
            )}
          </>
        )
      }
      overlay={
        <CandidateSheet visible={!recording} onConfirm={words.onAdd} onRetake={onRetake} />
      }
    >
      <View style={[styles.card, handLost && styles.cardFailed]}>
        {/* 카메라는 실패 상태에서도 유지한다(복귀 시 재시작 지연 방지). 실패 패널이 위를 덮는다. */}
        <SignCameraView onDetectionChange={setDetection} />

        {handLost ? (
          <View style={styles.failPanel} testID="sign-input-hand-lost">
            <View style={styles.failBadge}>
              <Badge label={strings.signInput.failBadge} variant="error" />
            </View>
            <View style={styles.failCenter}>
              {/* 경고 아이콘 — 확정 자산 전 placeholder 도형(원 + 느낌표). */}
              <View style={styles.failIconCircle}>
                <View style={styles.failIconBar} />
                <View style={styles.failIconDot} />
              </View>
              <Text style={styles.failTitle}>{strings.signInput.failTitle}</Text>
            </View>
          </View>
        ) : !recording ? // 후보 시트 단계 — 촬영이 끝났으므로 녹화 배지와 가이드는 걷는다.
        null : (
          <View style={styles.cardOverlay} pointerEvents="none">
            <View style={styles.recordBadge}>
              <Badge
                label={`${strings.signInput.recordingBadge} ${formatSeconds(recordSeconds)}`}
                variant="recording"
                testID="sign-input-recording-badge"
              />
            </View>
            <View style={styles.guideBox} />
            {handsVisible ? (
              <Text style={styles.guideText} testID="sign-input-hands-visible">
                {strings.signInput.handsVisible}
              </Text>
            ) : (
              // 자리 유지용 — 검출 전에는 문구만 숨긴다(가이드 박스 위치가 튀지 않게).
              <Text style={[styles.guideText, styles.guideTextHidden]}>
                {strings.signInput.handsVisible}
              </Text>
            )}
          </View>
        )}
      </View>
    </ScreenFrame>
  );
}

/** mock 녹화 타이머 표기 (mm:ss). */
function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.bg.video,
  },
  cardFailed: {
    borderWidth: 1.5,
    borderColor: colors.status.error,
    backgroundColor: colors.status.errorSubtle,
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.lg,
  },
  recordBadge: {
    alignSelf: 'flex-start',
  },
  guideBox: {
    flex: 1,
    marginTop: spacing.lg,
    marginHorizontal: spacing.xl,
    borderWidth: 2,
    borderColor: colors.status.success,
    borderRadius: radius.xl,
  },
  guideText: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
    color: colors.status.success,
  },
  guideTextHidden: {
    opacity: 0,
  },
  failPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.lg,
    backgroundColor: colors.status.errorSubtle,
  },
  failBadge: {
    alignSelf: 'flex-start',
  },
  failCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  failIconCircle: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.status.errorSoft,
  },
  failIconBar: {
    width: 8,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.status.error,
  },
  failIconDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.status.error,
  },
  failTitle: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.text.primary,
    textAlign: 'center',
  },
  stopRow: {
    alignItems: 'center',
  },
  stopButton: {
    borderWidth: 2.5,
    borderColor: colors.status.error,
    backgroundColor: colors.bg.canvas,
  },
  stopSquare: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: colors.status.error,
  },
});
