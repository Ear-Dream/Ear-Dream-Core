/**
 * 수어 입력 화면의 카메라 프리뷰 — 네이티브(기본) 구현.
 *
 * MediaPipe tasks-vision 은 브라우저 WASM 기반이라 Expo Go 를 포함한 네이티브에서 동작하지 않는다.
 * 알려진 정상 상태이므로 실패처럼 보이지 않게 안내만 띄운다(기존 T-03 동작 유지).
 * 번들러는 웹에서 SignCameraView.web.tsx 를 대신 고른다.
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../constants/theme';
import type { LandmarkerStatus } from './landmarks';

/** 수어 입력 화면이 예외 오버레이("손이 안 보여요") 판단에 쓰는 검출 상태 요약. */
export interface SignCameraDetectionState {
  status: LandmarkerStatus;
  handCount: number;
  error: string | null;
}

export interface SignCameraViewProps {
  /** 저빈도(HUD 주기)로 호출된다. 프레임 데이터가 아니라 상태 요약만 전달한다. */
  onDetectionChange?: (state: SignCameraDetectionState) => void;
}

export function SignCameraView({ onDetectionChange }: SignCameraViewProps) {
  useEffect(() => {
    // 네이티브에서는 검출이 돌지 않으므로 한 번만 알려준다.
    onDetectionChange?.({ status: 'unsupported', handCount: 0, error: null });
    // onDetectionChange 는 마운트 시점 한 번이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.root} testID="sign-camera-unsupported">
      <Text style={styles.glyph}>📷</Text>
      <Text style={styles.title}>카메라는 웹에서만 동작합니다</Text>
      <Text style={styles.body}>
        손 · 얼굴 랜드마크 추출은 브라우저 WASM 기반이라 Expo Go 에서는 실행되지 않습니다.
        {'\n'}
        <Text style={styles.code}>pnpm dev:web</Text> 으로 브라우저에서 확인하세요.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceStrong,
  },
  glyph: {
    fontSize: 40,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  code: {
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
