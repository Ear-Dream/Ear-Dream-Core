import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CircleIconButton } from '../../components/CircleIconButton';
import { MicFilledIcon } from '../../components/icons/TrackIcons';
import { Ripple } from '../../components/Ripple';
import { SpinnerRing } from '../../components/SpinnerRing';
import { TrackSwitchHandle } from '../../components/TrackSwitchHandle';
import { Waveform, WAVEFORM_BAR_COUNT } from '../../components/Waveform';
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
import { useMicLevels } from './audio';

/**
 * 파형용 마이크 스트림과 음성 인식이 마이크를 두고 부딪히는 플랫폼인가.
 *
 * 안드로이드에서 확인됐다 — 두 주체가 동시에 마이크를 열면 인식 엔진 쪽에 무음이 들어간다.
 * 기능 탐지로는 가릴 수 없어(부딪혔는지 물어보는 API 가 없다) 플랫폼으로 가른다.
 */
const MIC_CONFLICTS_WITH_RECOGNITION =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
import { useSpeechToText } from './stt';

export interface VoiceInputScreenProps {
  /**
   * 전달할 문장이 확정됐다 — **음성 인식 결과 또는 키보드 입력**. 두 경로를 하나로 받는 이유는
   * 다음 화면 입장에서 차이가 없기 때문이다(어느 쪽이든 "청인이 말한 내용"이다).
   */
  onSubmit: (text: string) => void;
  /**
   * 화면 아래 **손 손잡이** — 농인 트랙(수어 입력)으로 곧장 넘어간다.
   * 첫 화면을 거치지 않는다(2026-08-24 사용자 확정): 대화 중에 주도권만 넘기는 동작이라
   * 중간에 진입 선택 화면이 끼면 흐름이 끊긴다.
   */
  onSwitchToSign: () => void;
}

/**
 * 음성 입력 화면 (피그마 「최종」 `3. 청인 입력 — 음성` 460:2234): 인디고 카드 위의
 * 동심원 + 마이크 버튼 + 파형 + 키보드 폴백.
 *
 * ## 시안이 흰 화면이 아니라 인디고 카드다
 *
 * 청인 트랙의 모든 화면은 `bg/brandSurface`(= brand/primary 74%) 면 위에 서고, 글자는
 * 흰색·연회색이다. 화면 맨 아래 121pt 만 흰 띠로 남아 **수어 트랙으로 넘어가는 손잡이**
 * (`TrackSwitchHandle`)가 거기 앉는다. 시안에 AppBar 가 없어서 제목·뒤로가기 대신
 * 이 손잡이가 유일한 이동 경로다.
 *
 * 세로 배치는 시안 절대좌표를 **고정 높이 + 비율 스페이서**로 옮겼다. 요소 크기는 시안
 * 값(배율 환산)이고 사이 여백만 화면 높이에 따라 늘고 준다.
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
export function VoiceInputScreen({ onSubmit, onSwitchToSign }: VoiceInputScreenProps) {
  const { width } = useWindowDimensions();
  const scale = Math.min(width, maxScreenWidth) / DESIGN_FRAME_WIDTH;

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

    **2026-08-19 안드로이드 실기기에서 부딪히는 것이 확인됐다.** 예상한 'audio-capture' 실패가
    아니라 더 조용한 형태였다 — 엔진 이벤트가
    `start → audiostart → audioend → nomatch → end` 로, 오디오는 붙는데 `soundstart` 가
    한 번도 오지 않았다. 즉 인식 엔진에는 **무음**이 들어간다. 파형 스트림이 마이크를 잡고
    있어서다. iOS 에서는 둘이 공존해 정상 동작한다.

    그래서 위 주석이 예고한 대로 잘라낸다 — 파형은 장식이고 인식이 기능이다. 안드로이드에서만
    파형을 포기한다(반대로 하지 말 것 — 파형만 남으면 아무것도 못 한다). iOS·데스크톱은
    부딪히지 않으므로 그대로 둔다: 폰을 든 사람은 농인이라 소리가 들어오고 있다는 신호가
    파형뿐인 경우가 있다.
  */
  const { amplitudes, status: micStatus } = useMicLevels(
    listening && !MIC_CONFLICTS_WITH_RECOGNITION,
    WAVEFORM_BAR_COUNT,
  );
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

  const keyboardArea = textMode ? (
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
  );

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.spacerTop} />

        <Text style={[styles.title, koreanWordBreak]}>{strings.voiceInput.title}</Text>
        <Text style={styles.subtitle}>{strings.voiceInput.subtitle}</Text>

        <View style={styles.spacerBeforeStage} />

        {/*
          시안의 정적 동심원(halo + pond)은 그대로 두고, 듣는 중일 때만 그 위로 물결이
          퍼진다. idle 에서는 멈춰 있어서 물결 자체가 "지금 듣고 있다"는 시각 신호가 된다.
          연한 원(pond)은 물결이 퍼지는 수면 자리이자 버튼 배경이고, 듣는 중에는 여기에
          빨간 링이 붙는다. 세 원은 시안에서 중심이 같다(215, 368).
        */}
        <View style={[styles.micStage, { width: HALO_SIZE * scale, height: HALO_SIZE * scale }]}>
          <View style={[styles.halo, { width: HALO_SIZE * scale, height: HALO_SIZE * scale }]} />
          {/*
            가운데 원은 **채움과 테두리를 따로** 그린다. RN 의 opacity 는 자식까지 함께
            흐려지므로, 16% 원 안에 버튼을 넣으면 버튼도 16% 가 된다.
          */}
          <View style={[styles.pondFill, { width: POND_SIZE * scale, height: POND_SIZE * scale }]} />
          {listening ? (
            <View
              style={[styles.pondRing, { width: POND_SIZE * scale, height: POND_SIZE * scale }]}
            />
          ) : null}
          <View style={styles.stageCenter}>
            <CircleIconButton
              onPress={listening ? stt.stop : stt.start}
              accessibilityLabel={listening ? strings.voiceInput.stopAlt : strings.voiceInput.micAlt}
              size={MIC_BUTTON_SIZE * scale}
              // 음성을 못 쓰는 환경에서는 누를 수 없게 한다. 이유는 하단 캡션이 말해준다
              // (CircleIconButton 주석의 "왜 못 누르는지는 버튼 밖에서" 규칙).
              disabled={sttUnavailable}
              style={[styles.micButton, listening && styles.micButtonListening]}
              testID="voice-mic"
            >
              {listening ? (
                <View
                  style={[
                    styles.stopSquare,
                    { width: STOP_SQUARE_SIZE * scale, height: STOP_SQUARE_SIZE * scale },
                  ]}
                />
              ) : (
                <MicFilledIcon size={MIC_ICON_SIZE * scale} />
              )}
            </CircleIconButton>
          </View>
          {/*
            물결은 pond 뒤가 아니라 위에 겹쳐 그린다 — 뒤에 두면 불투명한 pond 에 가려
            버튼 가장자리에서 갓 태어난 구간(가장 짙은 구간)이 통째로 안 보인다.
            버튼 지름에서 시작하므로 버튼 위를 지나가지는 않고, 터치도 가로채지 않는다.
          */}
          <Ripple
            size={HALO_SIZE * scale}
            startScale={MIC_BUTTON_SIZE / HALO_SIZE}
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

        <View style={styles.spacerBeforeWave} />
        <Waveform amplitudes={amplitudes} testID="voice-waveform" />
        <View style={styles.spacerBeforeCaption} />

        <Text style={styles.noiseCaption} testID="voice-caption">
          {caption}
        </Text>

        <View style={styles.spacerBeforeButton} />
        {keyboardArea}
        <View style={styles.spacerBottom} />
      </View>

      {/*
        인식 결과를 기다리는 동안 (시안 `4. 청인 입력 — 로딩`, 460:2352).
        화면 전체에 스크림을 덮고 동심원 자리에 호가 돈다 — 시안은 화면을 통째로 가라앉히고
        **마이크 주위에서만** 진행을 보여준다. 별도 화면을 만들지 않은 이유는 이 대기가
        같은 화면의 한 상태이기 때문이다(예전의 고정 타이머 "인식 중" 화면과는 다르다).
      */}
      {stt.status === 'processing' ? (
        <View style={styles.loadingScrim} pointerEvents="none" testID="voice-loading">
          <SpinnerRing
            size={LOADING_RING_SIZE * scale}
            thickness={LOADING_RING_THICKNESS * scale}
            trackColor={LOADING_RING_TRACK}
          />
        </View>
      ) : null}

      {/* 시안의 하단 흰 띠 — 수어 트랙으로 넘어가는 손잡이. */}
      <TrackSwitchHandle
        variant="toSign"
        onPress={onSwitchToSign}
        accessibilityLabel={strings.common.switchToSignTrack}
        testID="voice-track-switch"
      />

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
    </View>
  );
}

/** 시안 프레임 폭 — 원 지름·아이콘을 이 값 대비 배율로 환산한다. */
const DESIGN_FRAME_WIDTH = 430;

/** 로딩 호 — 시안 실측 203.5 지름 · 두께 12 · 뒤 고리는 흰색 18% (460:2398). */
const LOADING_RING_SIZE = 203.5;
const LOADING_RING_THICKNESS = 12;
const LOADING_RING_TRACK = 'rgba(255, 255, 255, 0.18)';

/** 시안 실측(430pt 프레임): 세 원은 중심이 같고 지름만 다르다. */
const HALO_SIZE = 260;
/** 물결이 퍼지는 수면 겸 버튼 배경. */
const POND_SIZE = 196;
const MIC_BUTTON_SIZE = 132;
/** 버튼 안 마이크 아이콘 — 시안은 132 버튼에 115 아이콘(여백 9)이다. */
const MIC_ICON_SIZE = 115;
/** 듣는 중 정지 사각형. 시안에 치수가 없어 아이콘 대비로 잡은 임시값이다. */
const STOP_SQUARE_SIZE = 44;

/**
 * 시안 세로 좌표(430x932): 카드 0~811 / 손잡이 811~932.
 * 카드 안: 제목 121 · 부제 168 · 동심원 238 · 파형 534 · 캡션 663 · 버튼 727~787.
 * 요소 높이는 고정하고 사이 여백만 flex 로 두어 화면 높이에 따라 늘고 준다.
 */
const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    maxWidth: maxScreenWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg.canvas,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg.brandSurface,
  },
  /**
   * 로딩 스크림 — 시안은 화면 전체(433x935, 즉 프레임보다 살짝 넘치게)를 덮는다.
   * 색은 시안 애셋에서 값을 못 뽑아 앱의 모달 스크림과 같은 톤을 쓴다(임시).
   */
  loadingScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11, 15, 20, 0.45)',
  },
  spacerTop: { flex: 121 },
  spacerBeforeStage: { flex: 46 },
  spacerBeforeWave: { flex: 36 },
  spacerBeforeCaption: { flex: 36 },
  spacerBeforeButton: { flex: 42 },
  spacerBottom: { flex: 24 },
  // 시안 실측: Bold 30 / 행간 135% / 자간 -0.45.
  title: {
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 30 * 1.35,
    letterSpacing: -0.45,
    color: colors.text.onBrand,
    textAlign: 'center',
  },
  // 시안 실측: Regular 24 / 행간 145% / 자간 -0.36.
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 24,
    lineHeight: 24 * 1.45,
    letterSpacing: -0.36,
    color: colors.text.onBrandSubtle,
    textAlign: 'center',
  },
  transcript: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 26,
    color: colors.text.onBrand,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  transcriptHint: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text.onBrandSubtle,
  },
  /** 아직 확정되지 않은 구간 — 흐리게. */
  transcriptInterim: {
    color: colors.text.onBrandSubtle,
  },
  micStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** 동심원 바깥 고리 — 시안은 brand/subtle 을 불투명하게 깐다(460:2238). */
  halo: {
    position: 'absolute',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.subtle,
  },
  /** 가운데 원의 채움 — 시안은 brand/primary 16% (460:2239). */
  pondFill: {
    position: 'absolute',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
    opacity: 0.16,
  },
  /** 듣는 중에만 붙는 링. 채움과 분리되어 있어 투명도의 영향을 받지 않는다. */
  pondRing: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.status.errorSoft,
  },
  stageCenter: {
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: 8,
    backgroundColor: colors.status.error,
  },
  // 시안 실측: Regular 22 / 행간 150% / 자간 -0.33.
  noiseCaption: {
    fontFamily: fonts.regular,
    fontSize: 22,
    lineHeight: 22 * 1.5,
    letterSpacing: -0.33,
    color: colors.text.onBrandMuted,
    textAlign: 'center',
  },
  textRow: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  input: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.canvas,
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
