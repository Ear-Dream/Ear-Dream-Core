import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { RecognitionResult, SignSegment } from '@ear-dream/core';

import { Badge } from '../../components/Badge';
import { SendIcon } from '../../components/icons/SendIcon';
import { TrackSwitchHandle } from '../../components/TrackSwitchHandle';
import { DETECTION_GUIDE_DELAY_MS, RESULT_NOTICE_AUTO_DISMISS_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import {
  colors,
  fonts,
  koreanWordBreak,
  maxScreenWidth,
  radius,
  spacing,
  touchTarget,
} from '../../constants/theme';
import { useHandheldLandscape } from '../../hooks/useHandheldLandscape';
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
  /** "결과 확인" — 모든 pill 이 확정(done)일 때만 SignFlow 가 실제로 진행시킨다. */
  onCompose: () => void;
  /** /model 의 model_loaded. null = 카탈로그 미로드(미확인) — 배너를 띄우지 않는다. */
  modelReady: boolean | null;
  /**
   * 화면 위 **마이크 손잡이** — 청인 트랙(음성 입력)으로 곧장 넘어간다.
   * 첫 화면을 거치지 않는다(2026-08-24 사용자 확정).
   *
   * ⚠️ 이 전환은 `SignFlow` 를 언마운트하므로 **모아 둔 pill 큐가 비워진다**.
   * 대화 주도권을 넘기는 동작이라 그게 맞지만, 단어를 모으던 중이라면 사라진다.
   */
  onSwitchToVoice: () => void;
}

/** 시안 스트립의 칩 사이 간격 실측(자동차 96 끝 121 → 버스 시작 127). */
const STRIP_CHIP_GAP = 6;

/** 뷰파인더 안쪽 여백 — 가이드 박스와 오버레이 문구가 같은 값을 쓴다(사방 동일). */
const GUIDE_INSET = 16;

/** 「전달」 버튼의 종이비행기 크기. 시안의 글자(Bold 28)가 차지하던 높이에 맞춘 값이다. */
const COMPOSE_ICON_SIZE = 30;

/** 캡처 버튼 지름 — 시안 애셋 `Stop`(467:846) 실측 80. 최소 터치 타겟(48)을 넉넉히 넘는다. */
const CAPTURE_BUTTON_SIZE = 80;
/** 안쪽 원 지름 — 시안은 반지름 18 이다. */
const CAPTURE_INNER_SIZE = 36;

/**
 * 수어 입력 화면 — 확정 디자인의 비주얼(다크 뷰파인더 카드 + 녹화/인식 실패 배지 +
 * 가이드 박스 + 하단 단어 스트립)에 pill 큐(태그 입력) UX(2026-08-10 사용자 확정)를
 * 배선한 화면.
 *
 * 하단 대형 버튼을 **누르는 동안** 한 단어를 기록하고(boundary_mode: manual), 떼는 즉시
 * 스트립 끝에 대기 pill(···)이 붙는다. 사용자는 응답을 기다리지 않고 바로 다음 단어를 찍을 수
 * 있다 — 요청은 병렬, 순서는 큐가 보존한다. 응답이 오면 그 pill 이 top-1 단어로 자동
 * 확정된다(화면 전환 없음). 전면 "읽는 중" 스크림은 없다 — 대기 상태는 pill 이 표현한다.
 *
 * 정정 경로(전부 화면 하단, 엄지 범위, 항상 노출):
 *   대기 pill 탭 = 취소 · 확정 pill 탭 = 하단 시트(후보 교체/삭제) · 실패 pill 탭 = 재전송.
 */
export function SignInputScreen({
  queue,
  onCompose,
  modelReady,
  onSwitchToVoice,
}: SignInputScreenProps) {
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
  // 모바일 웹에서 폰이 가로로 돌아갔는지. 데스크톱 브라우저는 항상 false 다(훅 주석 참고).
  const landscape = useHandheldLandscape();
  const guide = useDebouncedGuide(detection);
  const recordSeconds = useRecordSeconds(recorder.recording);

  const chipsScrollRef = useRef<ScrollView | null>(null);
  const { entries, notice, dismissNotice } = queue;

  /*
    카드가 통째로 빨강으로 바뀌는 조건 — **인식 실패 하나뿐이다.**

    ⚠️ 예전에는 손이 계속 안 잡히는 상태(guide.kind === 'hands')도 여기에 묶여 있었는데,
    사용자 요청(2026-08-24)으로 뺐다. 손이 잠깐 프레임을 벗어나는 것은 촬영 중 늘 있는
    일이라 그때마다 화면이 빨개지면 경고가 의미를 잃는다. 손 미검출은 이제 **안내 문구만**
    바뀌고 카드·가이드 박스는 초록을 유지한다.
  */
  const recognitionFailed = notice?.kind === 'result';
  const cardAlert = recognitionFailed;

  /*
    검출 안내 문구를 띄우는 조건.

    ⚠️ **손이 안 잡히는 상태에서는 아무것도 띄우지 않는다**(2026-08-24 요청). 손이 잠깐
    프레임을 벗어나는 것은 촬영 중 늘 있는 일이라, 그때마다 문구가 뜨면 화면이 시끄럽고
    "지금 잘못하고 있다" 는 인상만 남는다. 어깨 안내는 성격이 달라(정확도 조언) 남긴다.

    녹화 중에도 띄우지 않는다 — 시안의 촬영 중 화면에는 배지 말고는 아무것도 없다.
  */
  const showGuideText =
    detection.status === 'running' &&
    !landscape &&
    !recorder.recording &&
    guide.kind !== 'hands';

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
  // 카메라 구동 여부와 **화면 방향**만 본다.
  //
  // ## 가로에서는 캡처를 막는다 (판단과 근거)
  //
  // 선택지는 둘이었다 — (a) 가로에서도 sourceWidth/Height 를 갱신해 계속 동작시키기,
  // (b) 세로 고정을 전제하고 가로에서는 안내하기. (b)를 골랐다.
  //
  //   · 세로가 학습·서빙 계약 쪽에 서 있다. 카메라 요청이 9:16 이고, 서버 AR 보정은
  //     x_scale = (W/H)/(16/9) 로 x 축 전체를 건드린다. 가로 프레임이 이 경로를 제대로 통과하는지
  //     **측정된 적이 없다** — 여기서 "아마 될 것" 으로 열어주면 조용히 틀린 데이터가 쌓인다.
  //   · 서비스 자세 자체가 세로다. 왼손 그립 · 프레이밍 가이드 박스 · 어깨 기준 정규화가 전부
  //     세로 구도를 전제하고, 어깨가 안 잡히면 서버가 low_quality(shoulders_not_visible)를 단다.
  //   · (a)를 완전히 버린 것은 아니다. sourceWidth/Height 는 프레임마다 실측값으로 계속 갱신되고
  //     (useLandmarker.web.ts), 세그먼트 중간에 좌표계가 바뀌면 useSegmentRecorder 가 폐기한다.
  //     즉 이 안내는 **첫 번째 방어선**이고, 뚫려도 틀린 좌표가 서버로 나가지는 않는다.
  //
  // 되돌리는 방법: 가로 검증이 끝나면 아래 `&& !landscape` 와 landscapeNotice 를 걷어내면 된다.
  const canCapture = detection.status === 'running' && !landscape;
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
    if (detection.status !== 'running' || landscape) return;
    setLocalError(null);
    if (notice) dismissNotice();
    captureStartFeedback();
    recorder.start();
  }, [detection.status, landscape, recorder, notice, dismissNotice]);

  // 뗌과 시스템 취소(HoldToRecordButton 이 구분 없이 전달)의 공통 종료 지점.
  // 취소라도 그때까지 모인 프레임은 사용자의 실제 동작이므로 버리지 않고 정상 제출한다.
  const handleHoldEnd = useCallback(() => {
    if (!recorder.recording) return;
    captureStopFeedback();
    void recorder.stop().then((result) => {
      switch (result.kind) {
        case 'segment':
          queue.submitSegment(result.segment);
          return;
        // 기록 도중 좌표계가 바뀐 세그먼트는 보내지 않는다(useSegmentRecorder 주석).
        // pill 을 만들지 않는 이유: 재전송할 대상 자체가 없다. 다시 동작하는 수밖에 없다.
        case 'geometry-changed':
          setLocalError(strings.signInput.geometryChanged);
          return;
        case 'empty':
          setLocalError(strings.signInput.emptySegment);
      }
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

  /*
    단어 스트립 (시안 Group 54, 460:2764) — 연보라 띠에 pill 이 왼쪽으로 쌓이고
    「전달」은 오른쪽 고정이라, 스크롤과 무관하게 완료 버튼이 언제나 같은 자리에 있다.

    ⚠️ **위치가 시안과 다르다.** 시안은 이 띠를 화면 맨 아래에 붙이고 녹화 버튼을 그 위에
    두는데, 사용자 요청(2026-08-24)으로 **띠를 위, 녹화 버튼을 아래**로 바꿨다 — 녹화가
    가장 자주 누르는 조작이라 엄지에 제일 가까워야 한다는 판단이다. 되돌리려면 렌더에서
    `{wordStrip}` 과 footer 의 순서만 맞바꾸면 된다.
  */
  const wordStrip = (
    <View style={styles.strip} testID="sign-input-words">
      {entries.length === 0 ? (
        <Text style={styles.stripEmptyHint}>{strings.signInput.wordsEmpty}</Text>
      ) : (
        <ScrollView
          ref={chipsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsViewport}
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
              selected={entry.localId === sheetLocalId}
              testID={`sign-input-pill-${entry.localId}`}
            />
          ))}
        </ScrollView>
      )}

      <Pressable
        onPress={onCompose}
        // 모든 pill 이 확정일 때만 활성 — 대기/실패 pill 이 문장에서 조용히 빠지는
        // 사고(사용자 의도와 다른 문장)를 막는다. 이유는 아래 한 줄로 보인다.
        disabled={!allDone}
        accessibilityRole="button"
        accessibilityState={{ disabled: !allDone }}
        accessibilityLabel={strings.signInput.compose}
        style={({ pressed }) => [
          styles.composeButton,
          !allDone && styles.composeButtonDisabled,
          pressed && styles.composeButtonPressed,
        ]}
        testID="sign-input-compose"
      >
        {/*
          글자 없이 종이비행기 하나다(2026-08-24 요청). 라벨은 위 accessibilityLabel 로만
          남는다 — 화면에서 사라져도 스크린 리더는 무엇을 보내는 버튼인지 알아야 한다.
        */}
        <SendIcon size={COMPOSE_ICON_SIZE} color={colors.text.onBrand} />
      </Pressable>
    </View>
  );

  const footer = (
    <>
      {composeBlockedReason ? (
        <Text style={styles.composeBlockedText} testID="sign-input-compose-blocked">
          {composeBlockedReason}
        </Text>
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
  );

  return (
    <View style={styles.root}>
      {/* 시안의 상단 인디고 띠 — 음성 트랙으로 넘어가는 손잡이. AppBar 를 대체한다. */}
      <TrackSwitchHandle
        variant="toVoice"
        onPress={onSwitchToVoice}
        accessibilityLabel={strings.common.switchToVoiceTrack}
        testID="sign-input-track-switch"
      />

      <View style={[styles.card, cardAlert && styles.cardAlert]}>
        <SignCameraView onDetectionChange={setDetection} onFrame={recorder.onFrame} />

        <View style={styles.cardOverlay} pointerEvents="none">
          {/*
            프레이밍 가이드 박스 — 얼굴·양어깨·손이 들어올 자리를 시각화한다.
            **사방 여백이 같아야 해서**(2026-08-24 요청) 흐름 배치가 아니라 절대 레이어다.
            흐름에 두면 위로는 배지 줄이, 아래로는 안내 문구가 밀어내 상하만 두꺼워진다.

            **녹화 중에는 그리지 않는다** (시안 `3. 농인 입력 — 촬영 중`, 460:2813).
            찍는 동안 화면에 남는 것은 「녹화 중」 배지뿐이다 — 자리를 잡으라는 안내는
            찍기 전에 할 일이고, 찍는 중에 초록 테두리가 남아 있으면 무엇을 보라는
            신호인지 모호해진다.
          */}
          {recorder.recording ? null : (
            <View
              style={[styles.guideBox, cardAlert && styles.guideBoxAlert]}
              testID="sign-input-guide-box"
            />
          )}

          <View style={styles.overlayContent}>
          {modelReady === false ? (
            <Text style={styles.modelBanner} testID="sign-input-model-banner">
              {strings.signInput.modelNotReady}
            </Text>
          ) : null}

          {/* 상단 배지 줄 — 왼쪽 녹화 중 / 오른쪽 인식 실패 (확정 디자인 2-1 배치). */}
          <View style={styles.badgeRow}>
            {recorder.recording ? (
              <Badge
                label={`${strings.signInput.recordingBadge} ${formatSeconds(recordSeconds)}`}
                variant="recording"
                testID="sign-input-recording"
              />
            ) : null}
            {recognitionFailed ? (
              <Badge
                label={strings.signInput.failedBadge}
                variant="error"
                testID="sign-input-failed-badge"
              />
            ) : null}
          </View>

          {/* 가이드 박스가 차지하는 자리 — 문구가 박스 아래로 가도록 밀어낸다. */}
          <View style={styles.overlaySpacer} />

          {showGuideText ? (
            <Text
              style={[
                styles.guideText,
                guide.kind !== 'ok' && styles.guideTextWarn,
                cardAlert && styles.guideTextAlert,
                koreanWordBreak,
              ]}
              testID="sign-input-guide"
            >
              {guide.message}
            </Text>
          ) : null}
          </View>
        </View>

        {/* 가로 안내 — 프리뷰를 덮는다. 캡처 버튼도 함께 비활성이라 "왜 안 눌리는지"가 여기 보인다.
            글자에만 의존하지 않게 아이콘을 함께 둔다(접근성 규칙). */}
        {landscape ? (
          <View style={styles.landscapeNotice} pointerEvents="none" accessibilityRole="alert">
            <Text style={styles.landscapeGlyph}>📱</Text>
            <View style={styles.landscapeTexts}>
              <Text style={styles.landscapeTitle} testID="sign-input-landscape">
                {strings.signInput.landscapeTitle}
              </Text>
              <Text style={styles.landscapeBody}>{strings.signInput.landscapeBody}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {wordStrip}
      <View style={styles.footer}>{footer}</View>

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
    </View>
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

/** 녹화 배지의 경과 시간. 실제 recorder.recording 에 묶인다 — mock 타이머가 아니다. */
function useRecordSeconds(recording: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);
  return seconds;
}

/** 녹화 배지 시간 표기 (mm:ss). */
function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  /**
   * 시안에 AppBar 가 없다 — 상단 인디고 띠(트랙 전환 손잡이) 아래로 곧장 뷰파인더다.
   * 좌우 여백 16 은 시안의 뷰파인더 마진(398/430)과 같다.
   */
  root: {
    flex: 1,
    width: '100%',
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg.canvas,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  /**
   * 뷰파인더 — **여백 없이 화면을 채운다**(2026-08-24 사용자 요청).
   *
   * 시안은 398x649 카드를 좌우 16 여백과 반경 16 으로 띄워 두지만, 카메라가 잘 보이는 것이
   * 우선이라 여백·라운드를 걷어냈다. 인식 실패 시 테두리가 빨강으로 바뀌는 표시는 유지한다.
   */
  card: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 3,
    borderColor: 'transparent',
    backgroundColor: colors.bg.video,
  },
  /** 확정 디자인 「2-1. 인식 실패」 — 카드 테두리가 빨강으로 바뀐다. */
  cardAlert: {
    borderColor: colors.status.error,
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  /** 배지·안내 문구가 흐르는 층. 가이드 박스와 같은 여백을 써서 서로 맞물린다. */
  overlayContent: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: GUIDE_INSET,
  },
  /** 가이드 박스가 차지하는 세로 자리 — 안내 문구를 박스 아래로 밀어낸다. */
  overlaySpacer: {
    flex: 1,
  },
  modelBanner: {
    alignSelf: 'stretch',
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    // 배지가 하나뿐일 때도 자리가 흔들리지 않게 최소 높이를 준다.
    minHeight: 30,
  },
  // 확정 디자인의 프레이밍 가이드 — 초록 라운드 프레임.
  // 다크 면 위라 `success`(밝은 면용)가 아니라 `successOnDark` 다.
  /**
   * 가이드 박스 — 카드 안쪽에서 **사방 같은 여백**(GUIDE_INSET)으로 떠 있다.
   * 시안은 좌우 16 · 위 21 로 살짝 다르지만 사용자 요청(2026-08-24)으로 통일했다.
   */
  guideBox: {
    position: 'absolute',
    top: GUIDE_INSET,
    right: GUIDE_INSET,
    bottom: GUIDE_INSET,
    left: GUIDE_INSET,
    // 시안 실측: 테두리 3 · 반경 20 (460:2483).
    borderWidth: 3,
    borderColor: colors.status.successOnDark,
    borderRadius: 20,
  },
  guideBoxAlert: {
    borderColor: colors.status.error,
  },
  // 검출 안내 — 비차단 문구. 잘 보일 때는 초록, 조정이 필요하면 흰색으로 갈린다.
  // 시안 실측 그대로: Medium 32 / 행간 145% / 자간 -0.48 / status-success-on-dark (460:2484).
  guideText: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fonts.medium,
    fontSize: 32,
    lineHeight: 32 * 1.45,
    letterSpacing: -0.48,
    textAlign: 'center',
    color: colors.status.successOnDark,
  },
  guideTextWarn: {
    fontSize: 20,
    lineHeight: 28,
    color: colors.text.onVideo,
  },
  // 확정 디자인 「2-1. 인식 실패」 실측: Bold 40 / 행간 135% / #c62828.
  guideTextAlert: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 46,
    color: colors.status.errorOnDark,
  },
  // 가로 안내 — 프리뷰 위 전면 스크림. 시안에 없는 화면이라 배색·치수는 임시값이다.
  // ⚠️ 이 안내가 뜨는 상황은 정의상 **가로**라 카드 높이가 매우 낮다(실측: 375x812 기준
  // 가로 전환 시 90px 남짓). 여백을 크게 잡으면 문구가 잘려서, 정작 읽혀야 할 때 안 읽힌다.
  landscapeNotice: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
  },
  landscapeTexts: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  landscapeGlyph: {
    fontSize: 32,
    // 세로로 되돌리라는 뜻이 도형으로도 읽히게 눕혀 둔다(색·글자에만 의존하지 않기).
    transform: [{ rotate: '90deg' }],
  },
  landscapeTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.text.onVideo,
  },
  landscapeBody: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.onVideo,
  },
  // 하단 단어 스트립 — V2 시안 SelectedWordStrip 배치를 pill 큐로 채운 것.
  /**
   * 단어 스트립 면. 시안 실측: 398x121 · 위쪽 모서리만 20 · #d5d5fa.
   * (화면에서의 상하 위치는 렌더 순서가 정한다 — wordStrip 주석 참고.)
   */
  strip: {
    marginHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: STRIP_CHIP_GAP,
    minHeight: 121,
    paddingHorizontal: spacing.sm,
    // 화면 아래에 붙는 띠가 아니라 **떠 있는 밴드**라 네 모서리를 모두 굴린다.
    borderRadius: 20,
    backgroundColor: colors.bg.wordStrip,
  },
  // flexShrink 로 남는 폭만 차지하게 둔다 — "결과 확인" 이 pill 에 밀려 잘리면 안 된다.
  chipsViewport: {
    flexShrink: 1,
  },
  chipsRow: {
    alignItems: 'center',
    gap: STRIP_CHIP_GAP,
    paddingVertical: spacing.xs,
  },
  stripEmptyHint: {
    flexShrink: 1,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
  },
  // 시안 「전달」 버튼(460:2771): 87x59.7 · 반경 12 · brand/primary · Bold 28 + 화살촉.
  composeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: 'auto',
    minHeight: Math.max(touchTarget.minHeight, 60),
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.primary,
  },
  composeButtonDisabled: {
    opacity: 0.45,
  },
  composeButtonPressed: {
    opacity: 0.85,
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
  // 시안 `Stop`(467:846): 흰 원 + 테두리 4 + 안쪽 원 지름 36, 색은 recordReady.
  captureButton: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.status.recordReady,
    backgroundColor: colors.bg.canvas,
  },
  /**
   * 녹화 중 — 테두리만 초록에서 빨강으로 바뀐다. 면은 흰색 그대로다(2026-08-24 요청).
   * 안쪽 도형도 원 → 정사각형으로 함께 바뀌므로 색만으로 상태를 말하지 않는다.
   * 버튼을 떼면 이 스타일이 빠지면서 초록 동심원으로 되돌아온다.
   */
  captureButtonRecording: {
    borderColor: colors.status.error,
  },
  captureButtonDisabled: {
    opacity: 0.4,
  },
  captureInner: {
    width: CAPTURE_INNER_SIZE,
    height: CAPTURE_INNER_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.status.recordReady,
  },
  // 기록 중에는 원 → 정사각형(카메라 녹화 버튼 관례) — 색에만 의존하지 않는 피드백.
  captureInnerRecording: {
    width: CAPTURE_INNER_SIZE * 0.8,
    height: CAPTURE_INNER_SIZE * 0.8,
    // 모서리를 살짝만 굴린다. 완전한 직각은 작은 크기에서 거칠게 읽힌다.
    borderRadius: 4,
    backgroundColor: colors.status.error,
  },
  captureHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
  },
});
