import { StyleSheet, View } from 'react-native';

import { CircleIconButton } from '../../components/CircleIconButton';
import { SpeakerIcon } from '../../components/icons/SpeakerIcon';
import { SpinnerRing } from '../../components/SpinnerRing';
import { strings } from '../../constants/strings';
import { colors, radius } from '../../constants/theme';

/**
 * useSpeech 의 status 계약을 화면 쪽에서 받는 표현용 union.
 *
 * 훅에서 import 하지 않고 여기서 선언한다 — 이 컴포넌트는 "어떤 엔진이 왜 그 상태인지"를
 * 모르는 표현 전용이고, 그래야 나중에 다른 재생 소스에도 그대로 쓸 수 있다. 훅의 status 가
 * 이 union 의 부분집합이면 그대로 넘어간다.
 */
export type SpeakerStatus = 'idle' | 'loading' | 'speaking' | 'unsupported' | 'error';

export interface SpeakerButtonProps {
  status: SpeakerStatus;
  /** idle · error 에서는 재생, speaking 에서는 정지. loading · unsupported 에서는 호출되지 않는다. */
  onPress: () => void;
  /** 한 번이라도 재생된 뒤인지 — 스크린리더 라벨이 "음성 재생" → "다시 듣기" 로 바뀐다. */
  played: boolean;
  testID?: string;
}

/**
 * 음성 전달 화면의 스피커 버튼 — 아이콘 자체가 재생 조작이다(장식 아님).
 *
 * 상태를 세 가지 서로 다른 **모양**으로 구분한다. 색이나 문구에만 기대면 안 되고
 * (색만으로 구분하지 않기 원칙), 특히 "준비 중"과 "재생 중"이 둘 다 그냥 도는 원처럼
 * 보이면 사용자는 6초를 기다리는 건지 이미 말하고 있는 건지 알 수 없다.
 *
 * | 상태 | 도형 | 움직임 |
 * | --- | --- | --- |
 * | idle · error | 스피커 | 없음 |
 * | loading | 스피커 + 흐림 | 버튼에 딱 붙은 **회전 링**(제자리에서 돈다) |
 * | speaking | 정지 사각형 | 바깥으로 **퍼지는 물결**(멀어지며 사라진다) |
 * | unsupported | 스피커 + 흐림 | 없음 |
 *
 * 재생 중에 누르면 "정지"다. 처음부터 다시 재생이 아닌 이유는 두 가지다 —
 * (1) 서버 TTS 는 요청당 수 초가 걸려서 재생 중 다시 누르면 또 몇 초를 기다리게 되고,
 * (2) 화면 변화가 없어(물결이 계속 돎) 눌린 건지 아닌지 사용자가 알 수 없다. 정지는
 * 물결이 멈추는 것으로 즉시 확인되고, 다시 듣고 싶으면 한 번 더 누르면 된다.
 * 앱 안의 마이크 버튼(음성 입력 화면)도 같은 규칙이라 조작이 한 벌로 유지된다.
 *
 * 정지 사각형 · 물결 · 원형 버튼은 음성 입력 화면(VoiceInputScreen)의 마이크와 같은 관용구다.
 */
export function SpeakerButton({ status, onPress, played, testID }: SpeakerButtonProps) {
  const loading = status === 'loading';
  const speaking = status === 'speaking';
  // loading 은 중복 요청(= 또 몇 초)을 막고, unsupported 는 눌러도 소리가 날 수 없다.
  const disabled = loading || status === 'unsupported';

  return (
    <View style={styles.stage}>
      {/*
        준비 중 링은 버튼 뒤(아래)에 깔린다 — 버튼 위를 지나가지 않는다.
        회전·「동작 줄이기」 처리는 SpinnerRing 이 갖는다(문장 변환 대기 화면과 한 벌).
      */}
      {loading ? (
        <SpinnerRing
          size={LOADING_RING_SIZE}
          thickness={LOADING_RING_THICKNESS}
          style={styles.loadingRing}
          testID="result-speaker-loading"
        />
      ) : null}

      <CircleIconButton
        onPress={onPress}
        accessibilityLabel={speakerLabel(status, played)}
        size={SPEAKER_SIZE}
        disabled={disabled}
        style={styles.speakerCircle}
        testID={testID}
      >
        {speaking ? (
          <View style={styles.stopSquare} />
        ) : (
          <SpeakerIcon size={SPEAKER_ICON_SIZE} color={colors.text.onBrand} />
        )}
      </CircleIconButton>
    </View>
  );
}

function speakerLabel(status: SpeakerStatus, played: boolean): string {
  if (status === 'loading') return strings.result.preparing;
  if (status === 'speaking') return strings.result.speakerStopAlt;
  // 한 번 들려준 뒤에는 이 버튼이 하는 일이 "재생"이 아니라 "다시 듣기"다.
  return played ? strings.result.replay : strings.result.speakerAlt;
}

/** 한 손 조작 최소 터치 타겟(48)을 크게 넘긴다 — 이 화면의 주 조작이다. */
const SPEAKER_SIZE = 88;
/** 버튼 안 아이콘. 시안 비율(원 지름의 절반쯤)에 맞춘 값이다. */
const SPEAKER_ICON_SIZE = 46;
/**
 * 무대 크기 — 준비 중 링이 버튼보다 크므로 그만큼 자리를 잡아 둔다.
 *
 * ⚠️ 예전에는 재생 중 물결(`Ripple`)이 여기까지 퍼졌는데, 시안에 없어서 걷어냈다
 * (2026-08-24 요청). 재생 중이라는 신호는 **파형**이 대신한다 — 파형이 실제로 움직이므로
 * 소리로만 전달되는 피드백이 되지는 않는다.
 */
const SPEAKER_STAGE_SIZE = 120;
/** 준비 중 링 — 버튼을 살짝 감싸는 크기. 퍼지는 물결과 달리 자리에서 돈다. */
const LOADING_RING_SIZE = 108;
const LOADING_RING_THICKNESS = 4;

const styles = StyleSheet.create({
  stage: {
    width: SPEAKER_STAGE_SIZE,
    height: SPEAKER_STAGE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerCircle: {
    backgroundColor: colors.brand.primary,
  },
  // 크기·색은 SpinnerRing 이 갖는다. 여기서는 버튼 뒤에 겹쳐 놓는 배치만 준다.
  loadingRing: {
    position: 'absolute',
  },
  stopSquare: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    backgroundColor: colors.text.onBrand,
  },
});
