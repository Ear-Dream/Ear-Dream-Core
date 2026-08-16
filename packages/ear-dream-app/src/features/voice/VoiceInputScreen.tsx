import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CircleIconButton } from '../../components/CircleIconButton';
import { Ripple } from '../../components/Ripple';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Waveform, WAVEFORM_BAR_COUNT } from '../../components/Waveform';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing, touchTarget } from '../../constants/theme';
import { useMicLevels } from './audio';
import { useSpeechToText } from './stt';

export interface VoiceInputScreenProps {
  /**
   * 전달할 문장이 확정됐다 — **음성 인식 결과 또는 키보드 입력**. 두 경로를 하나로 받는 이유는
   * 다음 화면 입장에서 차이가 없기 때문이다(어느 쪽이든 "청인이 말한 내용"이다).
   */
  onSubmit: (text: string) => void;
  onBack: () => void;
}

/**
 * 음성 입력 화면 (V2 시안 "음성 입력"): 동심원 + 마이크 버튼 + 파형 + 키보드 폴백.
 *
 * - idle ↔ 듣는 중: 마이크 탭으로 전환. 듣는 중에는 버튼이 빨간 정지 사각형으로 바뀌고
 *   "● 듣고 있어요" 배지가 붙고 물결이 퍼진다. 정지 탭 → 인식된 문장을 다음 화면으로 넘긴다.
 * - 인식 텍스트: 듣는 동안 확정 텍스트 + 중간 텍스트(흐린 색)를 함께 보여준다. 폰을 든 사람은
 *   농인이라 상대의 말소리를 듣지 못하므로, 글자가 쌓이는 것이 "잘 잡히고 있다"의 유일한
 *   신호다(파형은 소리가 났다는 것까지만 알려준다).
 * - 못 알아들었을 때: 훅이 빈 결과를 돌려주면 알림을 띄우고 idle 로 돌아간다. 시안 주석
 *   ("음성 인식 시간(10초 이내)로 인식하지 못하면 다시 해달라는 알림창 → 프론트에서 처리")이
 *   여기에 해당하고, 대기 시간은 이제 화면 타이머가 아니라 STT 훅의 무음 안전장치가 센다
 *   (stt/config.ts). RN 의 Alert.alert 는 웹에서 동작하지 않아 인앱 Modal 로 구현했다.
 * - 음성을 못 쓰는 환경(네이티브 · iOS 계열 브라우저 · 권한 거부 · http): 마이크 버튼을 끄고
 *   이유를 캡션으로 알리며 **키보드 입력을 자동으로 펼친다**. 남은 유일한 경로라서다.
 */
export function VoiceInputScreen({ onSubmit, onBack }: VoiceInputScreenProps) {
  const [timeoutVisible, setTimeoutVisible] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [text, setText] = useState('');

  // 콜백 신원이 바뀌어도 훅 세션이 흔들리지 않게 ref 로 들고 최신 것을 부른다.
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const handleResult = useCallback((recognized: string) => {
    // 빈 문자열 = 한 마디도 알아듣지 못했다. 다음 화면으로 넘기면 빈 자막이 되므로 여기서 멈춘다.
    if (recognized.length === 0) {
      setTimeoutVisible(true);
      return;
    }
    onSubmitRef.current(recognized);
  }, []);

  const stt = useSpeechToText({ onResult: handleResult });
  // 'processing'(결과 확정 대기)까지 듣는 중으로 묶는다 — 사용자가 정지를 누른 직후 버튼이
  // 마이크로 되돌아갔다가 다시 정지로 바뀌는 깜빡임을 막는다.
  const listening =
    stt.status === 'starting' || stt.status === 'listening' || stt.status === 'processing';
  const sttUnavailable =
    stt.status === 'unsupported' || stt.status === 'denied' || stt.status === 'error';

  /*
    ⚠️ 마이크를 여는 주체가 둘이다. `useMicLevels` 는 파형을 그리려고 getUserMedia 로 스트림을
    잡고, 음성 인식 엔진은 자기 마이크를 따로 연다. 같은 `listening` 하나로 둘이 동시에 켜진다.

    데스크톱 Chrome 에서 둘이 부딪히는 것은 관측하지 못했지만 **실기기에서 확인되지 않았다** —
    부딪히면 STT 가 'audio-capture'(= 마이크 없음)로 실패하거나 파형이 멈춘다. 둘 중 무엇이
    죽든 사용자에게는 "고장"으로 보인다.

    부딪히는 것이 확인되면 잘라낼 곳은 여기다: 파형은 장식이고 인식이 기능이므로,
    `useMicLevels` 의 active 인자를 false 로 두어 **파형을 포기하고 인식을 살린다**.
    (반대로 하지 말 것 — 파형만 남으면 아무것도 못 한다.) 확인 전에 미리 자르지는 않는다.
  */
  const { amplitudes, status: micStatus } = useMicLevels(listening, WAVEFORM_BAR_COUNT);
  const micUnavailable =
    micStatus === 'denied' || micStatus === 'unsupported' || micStatus === 'error';

  // 음성이 막힌 환경에서는 키보드가 유일한 경로다. 사용자가 "키보드로 입력하기"를 찾아
  // 누르기를 기다리지 않고 미리 펼쳐 둔다.
  useEffect(() => {
    if (sttUnavailable) setTextMode(true);
  }, [sttUnavailable]);

  const caption =
    stt.error ??
    (micUnavailable
      ? strings.voiceInput.micUnavailableCaption
      : strings.voiceInput.noiseCaption);

  return (
    <ScreenFrame
      title={strings.voiceInput.appBarTitle}
      onBack={onBack}
      footer={
        <>
          <Text style={styles.noiseCaption} testID="voice-caption">
            {caption}
          </Text>
          {textMode ? (
            <View style={styles.textRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={strings.voiceInput.textPlaceholder}
                placeholderTextColor={colors.border.default}
                style={styles.input}
                testID="voice-text-input"
              />
              <Button
                label={strings.voiceInput.textConfirm}
                variant="outline"
                disabled={text.trim().length === 0}
                onPress={() => {
                  // 키보드로 넘어간 순간 마이크는 놓는다 — 두 입력이 동시에 살아 있을 이유가 없다.
                  stt.cancel();
                  onSubmitRef.current(text.trim());
                }}
                testID="voice-text-confirm"
              />
            </View>
          ) : (
            <Button
              label={strings.voiceInput.keyboardFallback}
              variant="outline"
              onPress={() => setTextMode(true)}
              testID="voice-text-toggle"
            />
          )}
        </>
      }
    >
      <View style={styles.center}>
        <Text style={styles.title}>{strings.voiceInput.title}</Text>
        <Text style={styles.subtitle}>{strings.voiceInput.subtitle}</Text>

        {/*
          시안의 겹친 정적 동심원 대신, 듣는 중일 때만 마이크 버튼을 중심으로 물결이 퍼진다.
          idle 에서는 멈춰 있어서 물결 자체가 "지금 듣고 있다"는 시각 신호가 된다.
          연한 원(pond)은 물결이 퍼지는 수면 자리이자 버튼 배경이고, 듣는 중에는 여기에
          빨간 링이 붙는다(원래 최외곽 링이 하던 역할).
        */}
        <View style={styles.micStage}>
          <View style={[styles.pond, listening && styles.pondListening]}>
            <CircleIconButton
              onPress={listening ? stt.stop : stt.start}
              accessibilityLabel={listening ? strings.voiceInput.stopAlt : strings.voiceInput.micAlt}
              size={MIC_BUTTON_SIZE}
              // 음성을 못 쓰는 환경에서는 누를 수 없게 한다. 이유는 하단 캡션이 말해준다
              // (CircleIconButton 주석의 "왜 못 누르는지는 버튼 밖에서" 규칙).
              disabled={sttUnavailable}
              style={[styles.micButton, listening && styles.micButtonListening]}
              testID="voice-mic"
            >
              {listening ? (
                <View style={styles.stopSquare} />
              ) : (
                // 마이크 아이콘 — 확정 자산 전 placeholder 도형(캡슐 + 받침).
                <View style={styles.micShape}>
                  <View style={styles.micCapsule} />
                  <View style={styles.micStand} />
                </View>
              )}
            </CircleIconButton>
          </View>
          {/*
            물결은 pond 뒤가 아니라 위에 겹쳐 그린다 — 뒤에 두면 불투명한 pond 에 가려
            버튼 가장자리에서 갓 태어난 구간(가장 짙은 구간)이 통째로 안 보인다.
            버튼 지름에서 시작하므로 버튼 위를 지나가지는 않고, 터치도 가로채지 않는다.
          */}
          <Ripple
            size={RIPPLE_SIZE}
            startScale={MIC_BUTTON_SIZE / RIPPLE_SIZE}
            active={listening}
            testID="voice-ripple"
          />
        </View>

        {stt.status === 'listening' ? (
          <Badge
            label={strings.voiceInput.listeningBadge}
            variant="listening"
            testID="voice-listening-badge"
          />
        ) : null}

        {/*
          인식 텍스트. 듣는 동안에만 자리를 차지한다(idle 에서 빈 칸이 남지 않게).
          중간 텍스트는 흐린 색이다 — 아직 바뀔 수 있는 값이라 확정 텍스트와 같은 무게로
          보여주면 안 된다. 최종 결과로도 확정 텍스트를 우선한다(stt 훅 finish 참고).
        */}
        {listening ? (
          <Text style={styles.transcript} numberOfLines={3} testID="voice-transcript">
            {stt.transcript.length === 0 && stt.interimTranscript.length === 0 ? (
              <Text style={styles.transcriptHint}>{strings.voiceInput.transcriptHint}</Text>
            ) : (
              <>
                {stt.transcript}
                {stt.interimTranscript.length > 0 ? (
                  <Text style={styles.transcriptInterim}>
                    {stt.transcript.length > 0 ? ' ' : ''}
                    {stt.interimTranscript}
                  </Text>
                ) : null}
              </>
            )}
          </Text>
        ) : null}

        <Waveform amplitudes={amplitudes} testID="voice-waveform" />
      </View>

      {/* 못 알아들었을 때의 알림 — 웹에서 Alert.alert 가 no-op 이라 인앱 Modal 을 쓴다. */}
      <Modal visible={timeoutVisible} transparent animationType="fade">
        <View style={styles.modalScrim}>
          <View style={styles.modalCard} testID="voice-timeout-modal">
            <Text style={styles.modalTitle}>{strings.voiceInput.timeoutTitle}</Text>
            <Text style={styles.modalBody}>{strings.voiceInput.timeoutBody}</Text>
            <Button
              label={strings.voiceInput.timeoutConfirm}
              onPress={() => setTimeoutVisible(false)}
              testID="voice-timeout-confirm"
            />
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const MIC_BUTTON_SIZE = 104;
/** 물결이 퍼지는 수면 겸 버튼 배경. */
const POND_SIZE = 156;
/** 물결이 가장 멀리 퍼졌을 때의 지름 — 수면 밖까지 번져나간다. */
const RIPPLE_SIZE = 216;

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  transcript: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 26,
    color: colors.text.primary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  transcriptHint: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.secondary,
  },
  /** 아직 확정되지 않은 구간 — 흐리게. */
  transcriptInterim: {
    color: colors.text.secondary,
  },
  micStage: {
    width: RIPPLE_SIZE,
    height: RIPPLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pond: {
    width: POND_SIZE,
    height: POND_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.subtle,
  },
  pondListening: {
    borderWidth: 3,
    borderColor: colors.status.errorSoft,
  },
  micButton: {
    backgroundColor: colors.brand.primary,
  },
  micButtonListening: {
    borderWidth: 3,
    borderColor: colors.status.error,
  },
  micShape: {
    alignItems: 'center',
    gap: 3,
  },
  micCapsule: {
    width: 20,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.text.onBrand,
  },
  micStand: {
    width: 32,
    height: 14,
    borderWidth: 3,
    borderTopWidth: 0,
    borderColor: colors.text.onBrand,
    borderBottomLeftRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
  stopSquare: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.status.error,
  },
  noiseCaption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  textRow: {
    gap: spacing.sm,
  },
  input: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text.primary,
  },
  modalScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(11, 15, 20, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.canvas,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.text.primary,
    textAlign: 'center',
  },
  modalBody: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
