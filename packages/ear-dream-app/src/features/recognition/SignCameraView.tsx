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
import type { LandmarkerStatus, LandmarkSnapshot } from './landmarks';

/** 수어 입력 화면이 안내 문구("어깨가 안 보여요" 등) 판단에 쓰는 검출 상태 요약. */
export interface SignCameraDetectionState {
  status: LandmarkerStatus;
  handCount: number;
  /** 이 갱신 주기의 포즈(어깨) 관측 여부. 어깨 기준 정규화의 프레이밍 안내에 쓴다. */
  poseDetected: boolean;
  error: string | null;
}

export interface SignCameraViewProps {
  /** 저빈도(HUD 주기)로 호출된다. 프레임 데이터가 아니라 상태 요약만 전달한다. */
  onDetectionChange?: (state: SignCameraDetectionState) => void;
  /**
   * 매 프레임 원본 스냅샷. 세그먼트 레코더(useSegmentRecorder.onFrame)에 그대로 연결한다.
   * 리렌더 없는 경로이므로 여기서 React 상태를 건드리지 말 것.
   */
  onFrame?: (snapshot: LandmarkSnapshot) => void;
}

export function SignCameraView({ onDetectionChange }: SignCameraViewProps) {
  useEffect(() => {
    // 네이티브에서는 검출이 돌지 않으므로 한 번만 알려준다.
    onDetectionChange?.({ status: 'unsupported', handCount: 0, poseDetected: false, error: null });
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
    backgroundColor: colors.bg.surface,
  },
  glyph: {
    fontSize: 40,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  code: {
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
