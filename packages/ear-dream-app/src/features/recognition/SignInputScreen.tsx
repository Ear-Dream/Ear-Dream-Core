import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { WireButton } from '../../components/WireButton';
import { HAND_LOST_OVERLAY_DELAY_MS } from '../../constants/mock';
import { strings } from '../../constants/strings';
import { colors, radius, spacing, touchTarget } from '../../constants/theme';
import type { SignCameraDetectionState } from './SignCameraView';
import { SignCameraView } from './SignCameraView';

export interface SignInputScreenProps {
  onStartTranslate: () => void;
  onGoHome: () => void;
}

/**
 * 수어 입력 화면(농인 input). 카메라 프리뷰 + 하단 "번역 시작".
 *
 * 예외 상태(피그마 9, T-09 방향): 손이 앵글 밖으로 나가 검출이 끊기면 별도 화면으로 가지 않고
 * 이 화면 위에 "손이 안 보여요" 오버레이를 얹고, 하단 버튼을 재입력 유도 안내로 바꾼다.
 * 검출이 돌지 않는 플랫폼/상태(네이티브 unsupported, 카메라 에러)에서는 오버레이를 띄우지 않고
 * 버튼을 그대로 두어 흐름 확인이 막히지 않게 한다.
 */
export function SignInputScreen({ onStartTranslate, onGoHome }: SignInputScreenProps) {
  const [detection, setDetection] = useState<SignCameraDetectionState>({
    status: 'idle',
    handCount: 0,
    error: null,
  });
  const [handLost, setHandLost] = useState(false);

  useEffect(() => {
    if (detection.status !== 'running' || detection.handCount > 0) {
      setHandLost(false);
      return;
    }
    // 한두 프레임 검출 누락에 오버레이가 깜빡이지 않게 지연을 둔다(임시값, mock.ts 참고).
    const timer = setTimeout(() => setHandLost(true), HAND_LOST_OVERLAY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [detection.status, detection.handCount]);

  return (
    <ScreenFrame
      footer={
        <>
          {handLost ? (
            // 예외 상태에서는 주 버튼을 재입력 유도 안내로 교체한다 (피그마 9 하단 pill).
            <View style={styles.reinputPill} testID="sign-input-reinput-pill">
              <Text style={styles.reinputText}>{strings.signInput.reinputMessage}</Text>
            </View>
          ) : (
            <WireButton
              label={strings.signInput.startTranslate}
              onPress={onStartTranslate}
              testID="sign-input-start"
            />
          )}
          <WireButton
            label={strings.common.backToHome}
            onPress={onGoHome}
            variant="ghost"
            testID="sign-input-home"
          />
        </>
      }
    >
      <View style={styles.cameraArea}>
        <SignCameraView onDetectionChange={setDetection} />
        {handLost ? (
          <View style={styles.handLostOverlay} testID="sign-input-hand-lost">
            <View style={styles.handLostCard}>
              {/* 경고 아이콘 자리 — 확정 아이콘 전 글리프 placeholder */}
              <Text style={styles.handLostGlyph}>⚠</Text>
              <Text style={styles.handLostTitle}>{strings.signInput.handLostTitle}</Text>
              <Text style={styles.handLostBody}>{strings.signInput.handLostBody}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  cameraArea: {
    flex: 1,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  handLostOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.overlayScrim,
  },
  handLostCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: colors.overlayCard,
  },
  handLostGlyph: {
    fontSize: 32,
    color: colors.textPrimary,
  },
  handLostTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  handLostBody: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  reinputPill: {
    minHeight: touchTarget.minHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  reinputText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
});
