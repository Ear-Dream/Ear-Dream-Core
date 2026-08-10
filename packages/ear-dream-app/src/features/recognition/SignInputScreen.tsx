import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RecognitionResult, SignSegment } from '@ear-dream/core';

import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { DETECTION_GUIDE_DELAY_MS, RESULT_NOTICE_AUTO_DISMISS_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';
import type {
  QueueNotice,
  RecognitionEntry,
  RecognizerFailureKind,
} from './api/useRecognitionQueue';
import { captureStartFeedback, captureStopFeedback } from './capture/haptics';
import { HoldToRecordButton } from './capture/HoldToRecordButton';
import { useSegmentRecorder } from './capture/useSegmentRecorder';
import { QueuePill } from './QueuePill';
import type { SignCameraDetectionState } from './SignCameraView';
import { SignCameraView } from './SignCameraView';
import { WordCandidateSheet } from './WordCandidateSheet';

/** 인식 큐 조작 묶음 — useRecognitionQueue 를 SignFlow 가 소유하고 여기엔 조작만 넘긴다. */
export interface RecognitionQueueControls {
  entries: readonly RecognitionEntry[];
  submitSegment: (segment: SignSegment) => void;
  retryEntry: (localId: string) => void;
  removeEntry: (localId: string) => void;
  chooseCandidate: (localId: string, index: number) => void;
  notice: QueueNotice | null;
  dismissNotice: () => void;
}

export interface SignInputScreenProps {
  queue: RecognitionQueueControls;
  /** "문장 만들기" — 모든 pill 이 확정(done)일 때만 SignFlow 가 실제로 진행시킨다. */
  onCompose: () => void;
  /** /model 의 model_loaded. null = 카탈로그 미로드(미확인) — 배너를 띄우지 않는다. */
  modelReady: boolean | null;
  onBack: () => void;
}

/** 그립손 엄지용 캡처 버튼 지름. 최소 터치 타겟(48)을 훨씬 초과하는 임시값(확정 디자인 아님). */
const CAPTURE_BUTTON_SIZE = 88;

/**
 * 수어 입력 화면 — pill 큐(태그 입력) UX (2026-08-10 사용자 확정).
 *
 * 하단 대형 버튼을 **누르는 동안** 한 단어를 기록하고(boundary_mode: manual), 떼는 즉시
 * 큐 끝에 대기 pill(···)이 붙는다. 사용자는 응답을 기다리지 않고 바로 다음 단어를 찍을 수
 * 있다 — 요청은 병렬, 순서는 큐가 보존한다. 응답이 오면 그 pill 이 top-1 단어로 자동
 * 확정된다(화면 전환 없음). 전면 "읽는 중" 스크림은 없다 — 대기 상태는 pill 이 표현한다.
 *
 * 정정 경로(전부 화면 하단, 엄지 범위, 항상 노출):
 *   대기 pill 탭 = 취소 · 확정 pill 탭 = 하단 시트(후보 교체/삭제) · 실패 pill 탭 = 재전송.
 */
export function SignInputScreen({ queue, onCompose, modelReady, onBack }: SignInputScreenProps) {
  const [detection, setDetection] = useState<SignCameraDetectionState>({
    status: 'idle',
    handCount: 0,
    poseDetected: false,
    error: null,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  // 하단 시트가 가리키는 done 엔트리. 엔트리 배열에서 localId 로 매번 찾는다 —
  // 교체(chosenCandidateIndex 변경)가 시트에 즉시 반영되고, 삭제되면 자동으로 닫힌다.
  const [sheetLocalId, setSheetLocalId] = useState<string | null>(null);
  const recorder = useSegmentRecorder();
  const guide = useDebouncedGuide(detection);

  const chipsScrollRef = useRef<ScrollView | null>(null);
  const { entries, notice, dismissNotice } = queue;

  const pendingCount = entries.filter((entry) => entry.state === 'pending').length;
  const failedCount = entries.filter((entry) => entry.state === 'failed').length;
  const allDone = entries.length > 0 && pendingCount === 0 && failedCount === 0;

  const sheetEntry =
    entries.find(
      (entry): entry is Extract<RecognitionEntry, { state: 'done' }> =>
        entry.localId === sheetLocalId && entry.state === 'done',
    ) ?? null;

  // 캡처는 검출 상태(손·어깨)로도, 진행 중 인식으로도 게이팅하지 않는다 — 병렬 요청이
  // 허용되므로 "읽는 중" 에도 다음 단어를 바로 찍는 것이 이 UX 의 핵심이다.
  // 카메라 구동 여부만 본다.
  const canCapture = detection.status === 'running';
  // ## 계약: 활성 녹화의 종료 트리거는 "사용자가 손가락을 뗌" 단 하나다.
  // 검출 상태 변화, 리렌더, pill/배너 등장, disabled 전환, 제스처 경합 — 그 무엇도
  // 녹화를 끝내면 안 된다. 그래서 녹화 중에는 disabled 값을 동결한다: recording 인 동안
  // detection 이 어떻게 바뀌어도 이 값은 false 로 고정이다. (disabled 전환은
  // 진행 중인 press 를 취소시킬 수 있고, HoldToRecordButton 쪽에서도 disabled 는
  // 새 hold 의 시작만 막지 진행 중인 hold 를 끊지 않는다.)
  const captureDisabled = recorder.recording ? false : !canCapture;

  // 인라인 배너는 몇 초 뒤 자동 소멸한다. 다음 캡처 시작 시에도 즉시 사라진다(pressIn).
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, RESULT_NOTICE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  const handleHoldStart = useCallback(() => {
    if (detection.status !== 'running') return;
    setLocalError(null);
    if (notice) dismissNotice();
    captureStartFeedback();
    recorder.start();
  }, [detection.status, recorder, notice, dismissNotice]);

  // 뗌과 시스템 취소(HoldToRecordButton 이 구분 없이 전달)의 공통 종료 지점.
  // 취소라도 그때까지 모인 프레임은 사용자의 실제 동작이므로 버리지 않고 정상 제출한다.
  const handleHoldEnd = useCallback(() => {
    if (!recorder.recording) return;
    captureStopFeedback();
    void recorder.stop().then((segment) => {
      if (segment) queue.submitSegment(segment);
      else setLocalError(strings.signInput.emptySegment);
    });
  }, [recorder, queue]);

  const handlePillPress = useCallback(
    (entry: RecognitionEntry) => {
      switch (entry.state) {
        case 'pending':
          // 이전 UX 의 "취소" 대체 — 대기 pill 탭이 그 요청을 끊고 자리를 지운다.
          queue.removeEntry(entry.localId);
          return;
        case 'failed':
          queue.retryEntry(entry.localId);
          return;
        case 'done':
          setSheetLocalId(entry.localId);
      }
    },
    [queue],
  );

  const composeBlockedReason =
    entries.length > 0 && !allDone
      ? pendingCount > 0
        ? strings.signInput.composeBlockedPending
        : strings.signInput.composeBlockedFailed
      : null;

  return (
    <ScreenFrame
      title={strings.signInput.appBarTitle}
      onBack={onBack}
      footer={
        <>
          {entries.length > 0 ? (
            <ScrollView
              ref={chipsScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              // 최신 pill(방금 붙은 대기 pill)이 항상 보이게 끝으로 앵커한다.
              onContentSizeChange={() => chipsScrollRef.current?.scrollToEnd({ animated: true })}
              testID="sign-input-chips"
            >
              {entries.map((entry) => (
                <QueuePill
                  key={entry.localId}
                  entry={entry}
                  onPress={() => handlePillPress(entry)}
                  onRemove={
                    entry.state === 'failed' ? () => queue.removeEntry(entry.localId) : undefined
                  }
                  testID={`sign-input-pill-${entry.localId}`}
                />
              ))}
            </ScrollView>
          ) : null}

          {localError ? <Text style={styles.errorText}>{localError}</Text> : null}

          {notice ? (
            notice.kind === 'result' ? (
              <View
                style={styles.resultNotice}
                testID={`sign-input-notice-${notice.result.status}`}
                accessibilityRole="alert"
              >
                <Text style={styles.resultNoticeText}>{resultNoticeMessage(notice.result)}</Text>
              </View>
            ) : (
              // 전송 실패 배너 — 이유 안내만 한다. 재전송·삭제 조작은 failed pill 자체에 있다.
              <View
                style={styles.failureNotice}
                testID="sign-input-send-failed"
                accessibilityRole="alert"
              >
                <Text style={styles.failureNoticeText}>{failureMessage(notice.failure)}</Text>
              </View>
            )
          ) : null}

          {entries.length > 0 ? (
            <Button
              label={strings.signInput.compose}
              onPress={onCompose}
              // 모든 pill 이 확정일 때만 활성 — 대기/실패 pill 이 문장에서 조용히 빠지는
              // 사고(사용자 의도와 다른 문장)를 막는다. 이유는 아래 한 줄로 보인다.
              disabled={!allDone}
              testID="sign-input-compose"
            />
          ) : null}
          {composeBlockedReason ? (
            <Text style={styles.composeBlockedText} testID="sign-input-compose-blocked">
              {composeBlockedReason}
            </Text>
          ) : null}

          {/* 검출 상태가 바꾸는 표시(pill·배너)는 전부 버튼의 형제 요소다.
              버튼 서브트리는 녹화 중 구조가 변하지 않는다 — 구조 변화가 press 를
              흔드는 것 자체가 이 버튼이 막는 버그였다(HoldToRecordButton 참고). */}
          <View style={styles.captureRow}>
            <HoldToRecordButton
              accessibilityLabel={strings.signInput.captureAlt}
              disabled={captureDisabled}
              onHoldStart={handleHoldStart}
              onHoldEnd={handleHoldEnd}
              style={[
                styles.captureButton,
                recorder.recording && styles.captureButtonRecording,
                captureDisabled && styles.captureButtonDisabled,
              ]}
              testID="sign-input-capture"
            >
              <View
                style={[styles.captureInner, recorder.recording && styles.captureInnerRecording]}
              />
            </HoldToRecordButton>
          </View>
          <Text style={styles.captureHint}>{strings.signInput.captureHint}</Text>
        </>
      }
    >
      <View style={styles.card}>
        <SignCameraView onDetectionChange={setDetection} onFrame={recorder.onFrame} />

        <View style={styles.cardOverlay} pointerEvents="none">
          {modelReady === false ? (
            <Text style={styles.modelBanner} testID="sign-input-model-banner">
              {strings.signInput.modelNotReady}
            </Text>
          ) : null}
          <View style={styles.overlaySpacer} />
          {recorder.recording ? (
            <Text style={styles.recordingBadge} testID="sign-input-recording">
              ● {strings.signInput.recordingBadge}
            </Text>
          ) : null}
          {detection.status === 'running' ? (
            <Text
              style={[styles.guideText, guide.kind !== 'ok' && styles.guideTextWarn]}
              testID="sign-input-guide"
            >
              {guide.message}
            </Text>
          ) : null}
        </View>
      </View>

      <WordCandidateSheet
        entry={sheetEntry}
        onChoose={(index) => {
          if (sheetEntry) queue.chooseCandidate(sheetEntry.localId, index);
          setSheetLocalId(null);
        }}
        onRemove={() => {
          if (sheetEntry) queue.removeEntry(sheetEntry.localId);
          setSheetLocalId(null);
        }}
        onClose={() => setSheetLocalId(null)}
      />
    </ScreenFrame>
  );
}

type GuideKind = 'shoulders' | 'hands' | 'ok';

/**
 * 검출 안내 문구. "안 보임" 전환에만 지연을 둔다 — 한두 프레임 검출 누락에 문구가 깜빡이지 않게.
 * "보임" 전환은 즉시다(잘 되고 있다는 피드백은 빠를수록 좋다).
 */
function useDebouncedGuide(detection: SignCameraDetectionState): {
  kind: GuideKind;
  message: string;
} {
  // 손이 우선이다 — 인식의 실제 재료라서다. 어깨는 어드바이저리(서버도 이제
  // shoulders_not_visible 을 추론을 막지 않는 어드바이저리로 다룬다).
  let target: GuideKind = 'ok';
  if (detection.status === 'running') {
    if (detection.handCount === 0) target = 'hands';
    else if (!detection.poseDetected) target = 'shoulders';
  }

  const [kind, setKind] = useState<GuideKind>('ok');
  useEffect(() => {
    if (target === 'ok') {
      setKind('ok');
      return;
    }
    const timer = setTimeout(() => setKind(target), DETECTION_GUIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [target]);

  const message =
    kind === 'shoulders'
      ? strings.signInput.guideShouldersMissing
      : kind === 'hands'
        ? strings.signInput.guideHandsMissing
        : strings.signInput.guideAllVisible;
  return { kind, message };
}

/**
 * rejected/low_quality 인라인 배너 문구. 에러가 아니라 안내다 — 사용자가 할 일은
 * 버튼을 다시 누르고 동작하는 것뿐이므로, 첫 번째로 매핑되는 이슈 하나만 짧게 보여준다.
 */
function resultNoticeMessage(result: RecognitionResult): string {
  if (result.status === 'rejected') return strings.signInput.noticeRejected;
  for (const issue of result.quality_issues ?? []) {
    const message = strings.signInput.noticeIssues[issue];
    if (message) return message;
  }
  return strings.signInput.noticeLowQualityFallback;
}

function failureMessage(kind: RecognizerFailureKind): string {
  switch (kind) {
    case 'model_unavailable':
      return strings.signInput.sendFailedModel;
    case 'network':
      return strings.signInput.sendFailedNetwork;
    case 'server':
      return strings.signInput.sendFailedServer;
    case 'timeout':
      return strings.signInput.sendFailedTimeout;
  }
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
  cardOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.lg,
  },
  overlaySpacer: {
    flex: 1,
  },
  modelBanner: {
    alignSelf: 'stretch',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  recordingBadge: {
    alignSelf: 'center',
    marginBottom: spacing.sm,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.status.error,
  },
  // 작은 pill — 비차단 안내다. 검출이 안 돼도 캡처를 막지 않으므로 크게 외치지 않는다.
  guideText: {
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: colors.status.success,
  },
  guideTextWarn: {
    color: colors.text.onVideo,
  },
  chipsRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.status.error,
    textAlign: 'center',
  },
  // rejected/low_quality 인라인 배너 — 안내이지 실패가 아니므로 빨강을 쓰지 않는다.
  resultNotice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.subtle,
  },
  resultNoticeText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.primary,
    textAlign: 'center',
  },
  // 전송 실패 배너 — 실패이므로 빨강 계열. 조작 버튼은 없다(failed pill 이 조작 지점).
  failureNotice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.status.errorSubtle,
  },
  failureNoticeText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.status.error,
    textAlign: 'center',
  },
  composeBlockedText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  captureRow: {
    alignItems: 'center',
  },
  captureButton: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.status.error,
    backgroundColor: colors.bg.canvas,
  },
  captureButtonRecording: {
    backgroundColor: colors.status.errorSubtle,
  },
  captureButtonDisabled: {
    opacity: 0.4,
  },
  captureInner: {
    width: CAPTURE_BUTTON_SIZE * 0.55,
    height: CAPTURE_BUTTON_SIZE * 0.55,
    borderRadius: radius.pill,
    backgroundColor: colors.status.error,
  },
  // 기록 중에는 원 → 라운드 사각으로 바뀐다(카메라 녹화 버튼 관례) — 색에만 의존하지 않는 피드백.
  captureInnerRecording: {
    width: CAPTURE_BUTTON_SIZE * 0.4,
    height: CAPTURE_BUTTON_SIZE * 0.4,
    borderRadius: radius.sm,
  },
  captureHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
