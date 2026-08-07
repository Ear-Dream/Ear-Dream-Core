import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CircleIconButton } from '../../components/CircleIconButton';
import { ScreenFrame } from '../../components/ScreenFrame';
import { HAND_LOST_OVERLAY_DELAY_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type { SignCameraDetectionState } from './SignCameraView';
import { SignCameraView } from './SignCameraView';

export interface SignInputScreenProps {
  /** 정지 버튼 — 수어 인식 중 화면으로 진행. */
  onStop: () => void;
  onBack: () => void;
}

/**
 * 수어 입력 화면 (V2 시안 "수어 입력"): 다크 뷰파인더 카드 + 녹화 배지 + 가이드 박스 +
 * 하단 정지 버튼.
 *
 * 인식 실패 예외 (시안 "3번 인식 실패 예외"): 시안 프레임명은 3회 실패지만 실패 카운트는
 * 인식이 미구현이라 만들 수 없다. 그때까지는 손 미검출이 일정 시간(임시값, mock.ts) 지속되면
 * 이 상태로 전환하는 mock 트리거를 쓴다 — 카드가 연빨강 배경 + 빨간 테두리로 바뀌고
 * "다시 촬영하기"로 복귀한다.
 */
export function SignInputScreen({ onStop, onBack }: SignInputScreenProps) {
  const [detection, setDetection] = useState<SignCameraDetectionState>({
    status: 'idle',
    handCount: 0,
    error: null,
  });
  const [handLost, setHandLost] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  useEffect(() => {
    if (detection.status !== 'running' || detection.handCount > 0) {
      setHandLost(false);
      return;
    }
    // 한두 프레임 검출 누락에 화면이 깜빡이지 않게 지연을 둔다(임시값, mock.ts 참고).
    const timer = setTimeout(() => setHandLost(true), HAND_LOST_OVERLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [detection.status, detection.handCount]);

  // 녹화 타이머는 mock 이다 — 실제 녹화/버퍼링은 없고 배지 표시용으로만 센다(T-08 이전).
  useEffect(() => {
    if (handLost) return;
    const interval = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [handLost]);

  // 두 손 검출 상태 표시 — useLandmarker 의 검출 결과를 표시에만 쓴다(가공·버퍼링 없음).
  const handsVisible = detection.status === 'running' && detection.handCount >= 2;

  return (
    <ScreenFrame
      title={strings.signInput.appBarTitle}
      onBack={onBack}
      footer={
        handLost ? (
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
        )
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
        ) : (
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
