/**
 * 햅틱 진단 패널 — 개발 화면(`?dev=1`) 전용.
 *
 * ## 왜 만들었나
 *
 * "진동이 안 온다"의 원인이 층층이 있는데 폰에서는 콘솔을 열 수 없어 어느 층에서 끊겼는지
 * 볼 수가 없었다. 층은 넷이다:
 *
 *   1. 번들   — 폰이 낡은 번들을 쓰고 있나 (빌드 후 새로고침을 안 했나)
 *   2. 경로   — Vibration API 를 타나, iOS 우회를 타나, 아무것도 없나
 *   3. 브라우저 — 요청을 받아들였나 (`navigator.vibrate()` 반환값)
 *   4. 기기   — 받아들였는데 안 울리나 (무음·방해금지·시스템 진동 끔)
 *
 * 이 패널은 1~3 을 화면에 찍고, 버튼으로 4 를 손으로 확인하게 한다. **캡처 버튼을 거치지
 * 않고 진동만 단독으로 울리는 것**이 핵심이다 — 카메라·검출 상태·큐와 분리되므로,
 * 여기선 울리는데 캡처 버튼에서 안 울리면 원인이 진동이 아니라 캡처 흐름에 있다는 뜻이 된다.
 *
 * 「신호 집계」의 「잘림」은 겹침 회귀 감지용이다 — 진동이 시작 하나뿐인 한 항상 0 이다.
 *
 * ⚠️ 측정 도구다. 제품 화면에 넣지 말 것 — 렌더 비용이 아니라 의미의 문제다.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { captureStartFeedback, readHapticDiagnostics, type HapticDiagnostics } from './haptics';

const PATH_LABEL: Record<HapticDiagnostics['path'], string> = {
  vibration: 'Vibration API (안드로이드 계열)',
  'ios-switch': 'iOS switch 우회 (미검증 경로)',
  none: '없음 — 이 브라우저는 진동 수단이 없다',
};

export function HapticProbePanel() {
  const [snapshot, setSnapshot] = useState<HapticDiagnostics>(() => readHapticDiagnostics());

  // 각 버튼은 **실제 press** 여야 한다 — 브라우저가 사용자 제스처를 요구하므로
  // 코드로 대신 호출하면 진단 자체가 왜곡된다.
  const fire = useCallback((cue: () => void) => {
    cue();
    // 반환값은 호출 직후에만 의미가 있다 — 바로 읽어 화면에 반영한다.
    setSnapshot(readHapticDiagnostics());
  }, []);

  const accepted =
    snapshot.lastVibrateResult === null
      ? '아직 안 눌러 봄'
      : snapshot.lastVibrateResult
        ? 'true — 브라우저가 받아들임'
        : 'false — 브라우저가 거부함';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>햅틱 진단</Text>

      <Row label="경로" value={PATH_LABEL[snapshot.path]} />
      <Row label="navigator.vibrate" value={snapshot.vibrateAvailable ? '있음' : '없음'} />
      <Row label="switch 지원" value={snapshot.switchSupported ? '있음' : '없음'} />
      <Row label="마지막 반환값" value={accepted} />
      <Row label="문서 보임" value={snapshot.documentVisible ? '예' : '아니오'} />
      {/* 소스의 상수와 다르면 폰이 낡은 번들을 쓰고 있다는 뜻이다 — 추측 대신 증거. */}
      <Row label="번들 상수" value={`펄스 ${snapshot.pulseMs}ms`} />
      {/* 평소처럼 몇 단어 입력한 뒤 이 화면으로 돌아와 읽는다 — 모듈 전역 집계라 화면을
          옮겨도 유지된다. 「잘림」은 항상 0 이어야 한다(capture/haptics.ts 「계약」). */}
      <Row
        label="신호 집계"
        value={`울림 ${snapshot.counters.emitted} · 잘림 ${snapshot.counters.replaced}`}
      />

      <View style={styles.buttons}>
        <ProbeButton label="진동 울려보기" onPress={() => fire(captureStartFeedback)} />
        <ProbeButton label="집계 새로고침" onPress={() => setSnapshot(readHapticDiagnostics())} />
      </View>

      <Text style={styles.hint}>
        반환값이 true 인데 아무것도 안 느껴지면 브라우저는 요청을 받은 것이라 원인이 기기 쪽이다 —
        무음·방해금지 모드, 시스템 설정의 진동/터치 피드백 꺼짐을 확인한다. 여기서는 울리는데
        캡처 버튼에서 안 울리면 원인은 진동이 아니라 캡처 흐름이다.
        {'\n\n'}
        진동이 불규칙하면 수어 입력을 평소처럼 몇 단어 한 뒤 돌아와 「신호 집계」를 읽는다.
        「잘림」이 0 이 아니면 신호가 겹치고 있다는 뜻이고, 그건 곧 불규칙성이 돌아왔다는
        신호다 — 진동은 시작 하나뿐이라 겹칠 대상이 없어야 정상이다.
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ProbeButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    maxWidth: 720,
    gap: 6,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f4f4f5',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowLabel: {
    width: 130,
    fontSize: 13,
    color: '#666',
  },
  rowValue: {
    flex: 1,
    fontSize: 13,
    color: '#111',
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  button: {
    // 한손 조작 최소 터치 타겟(44pt)을 지킨다 — 실기기에서 엄지로 누를 버튼이다.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#111',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#555',
  },
});
