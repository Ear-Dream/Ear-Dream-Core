import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { ScreenFrame } from '../../components/ScreenFrame';
import { MOCK_RECOGNITION_DELAY_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, fonts, radius, spacing } from '../../constants/theme';

export interface RecognizingScreenProps {
  /**
   * 문구 컨텍스트. 시안에는 농인 트랙("수어 인식 중") 프레임만 있고 청인용은 없어서
   * 화면을 공용으로 쓰고 문구만 바꾼다(strings.recognizing 참고).
   */
  context: 'sign' | 'voice';
  /** 인식 완료 시 호출. 다음 화면 결정은 네비게이터 몫이다. */
  onDone: () => void;
  /** "취소하고 다시 찍기/말하기" — 입력 화면으로 복귀. AppBar 뒤로가기와 동일. */
  onCancel: () => void;
}

/**
 * 인식 중 화면 (V2 시안 "수어 인식 중"): 다크 카드 + 원형 프로그레스 링(% 텍스트) +
 * 하단 진행 바 + "취소하고 다시 찍기".
 *
 * 인식 파이프라인은 미구현이므로 진행률(68% 등)은 타이머 mock 이다(mock.ts).
 * 시안 카피 "보통 3초 정도 걸려요"도 실측값이 아니다.
 */
export function RecognizingScreen({ context, onDone, onCancel }: RecognizingScreenProps) {
  const copy = strings.recognizing[context];
  const [progress, setProgress] = useState(0);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const startedAt = Date.now();
    // 진행률은 실제 추론과 무관한 화면 전환 타이머 기반 mock 이다.
    const interval = setInterval(() => {
      const ratio = Math.min((Date.now() - startedAt) / MOCK_RECOGNITION_DELAY_MS, 0.99);
      setProgress(Math.round(ratio * 100));
    }, 80);
    const done = setTimeout(() => onDoneRef.current(), MOCK_RECOGNITION_DELAY_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(done);
    };
  }, []);

  // 링의 인디고 호(arc)를 회전시켜 진행 중임을 표현한다(실제 진행률 호가 아닌 스피너).
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <ScreenFrame
      title={copy.appBarTitle}
      onBack={onCancel}
      footer={<Button label={copy.cancel} variant="outline" onPress={onCancel} testID="recognizing-cancel" />}
    >
      <View style={styles.card} testID="recognizing-screen">
        <View style={styles.center}>
          <View style={styles.ringWrap}>
            <View style={styles.ringTrack} />
            <Animated.View style={[styles.ringArc, { transform: [{ rotate }] }]} />
            <Text style={styles.percent}>{progress}%</Text>
          </View>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${progress}%` }]} />
        </View>
      </View>
    </ScreenFrame>
  );
}

const RING_SIZE = 120;
const RING_WIDTH = 8;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginTop: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.video,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  ringTrack: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  ringArc: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: 'transparent',
    borderTopColor: colors.brand.primary,
    borderRightColor: colors.brand.primary,
  },
  percent: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.text.onVideo,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.text.onVideo,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
  },
  barTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.brand.primary,
  },
});
