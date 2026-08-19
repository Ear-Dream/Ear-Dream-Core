/**
 * 수어 입력 화면의 카메라 프리뷰 — 웹 구현.
 *
 * LandmarkDevScreen(개발 확인용)과 달리 HUD · 토글 없이 프리뷰 + 랜드마크 오버레이만 그린다.
 * 검출은 useLandmarker 훅이, 그리기는 overlay.web.ts(개발 화면과 공유)가 담당한다.
 *
 * 규칙 준수 메모:
 * - 랜드마크를 여기서 가공하지 않는다. 그리기와 손 개수 집계만 한다(전처리는 서버 소관, 설계 결정 1).
 * - displayFace 는 오버레이 그리기(표시)까지만 쓰인다. 버퍼/전송 금지.
 */
import { useCallback, useEffect, useRef } from 'react';

import { strings } from '../../constants/strings';
import { colors, radius } from '../../constants/theme';
import type { LandmarkSnapshot } from './landmarks';
import { PREVIEW_MIRRORED } from './landmarks';
import type { OverlayColors } from './landmarks/overlay.web';
import { drawSnapshot, HANDEDNESS_COLORS, UNKNOWN_HAND_COLOR } from './landmarks/overlay.web';
import { useLandmarker } from './landmarks/useLandmarker.web';
import type { SignCameraDetectionState, SignCameraViewProps } from './SignCameraView';

export type { SignCameraDetectionState, SignCameraViewProps };

// 오버레이 배색. 손은 handedness 라벨별 색(개발 화면과 공유)으로 좌우가 눈으로 구분되게 한다.
// 라벨 자체는 아직 미검증(HANDEDNESS_VERIFIED=false)이므로 색은 라벨 표시일 뿐 정오 보증이 아니다.
// 얼굴은 카메라 영상 위 가시성용 중립색이며 확정 디자인이 아니다.
const WIRE_OVERLAY_COLORS: OverlayColors = {
  handColors: HANDEDNESS_COLORS,
  fallbackHandColor: UNKNOWN_HAND_COLOR,
  handPointColor: '#FFFFFF',
  faceColor: 'rgba(255, 255, 255, 0.55)',
  // 어깨 2점 + 연결선 — 프레이밍 확인용 중립색. 확정 디자인이 아니다.
  poseColor: 'rgba(255, 255, 255, 0.8)',
};

export function SignCameraView({ onDetectionChange, onFrame }: SignCameraViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // 프레임 소비자(세그먼트 레코더)는 ref 로 들고 있는다 — 신원이 바뀌어도 루프가 흔들리지 않게.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // 검출 루프와 같은 tick 안에서 그리고, 원본 스냅샷을 소비자에게 그대로 넘긴다.
  // 이 경로는 React 상태를 건드리지 않는다.
  const handleFrame = useCallback((snapshot: LandmarkSnapshot) => {
    const canvas = canvasRef.current;
    if (canvas) drawSnapshot(canvas, snapshot, WIRE_OVERLAY_COLORS);
    onFrameRef.current?.(snapshot);
  }, []);

  const { status, error, hands, pose, videoRef } = useLandmarker({ onFrame: handleFrame });

  // 콜백 신원이 바뀌어도 effect 가 다시 돌지 않게 ref 로 들고 있는다.
  const callbackRef = useRef(onDetectionChange);
  callbackRef.current = onDetectionChange;

  const handCount = hands.length;
  const poseDetected = pose !== null;
  useEffect(() => {
    callbackRef.current?.({ status, handCount, poseDetected, error });
  }, [status, handCount, poseDetected, error]);

  // 미리보기 반전은 video 와 canvas 를 함께 감싼 래퍼에 건다. 반전 여부는 handedness.ts 소유.
  const mirrorStyle: React.CSSProperties = PREVIEW_MIRRORED ? { transform: 'scaleX(-1)' } : {};

  return (
    <div style={webStyles.root} data-testid="sign-camera-web">
      <div style={{ ...webStyles.stage, ...mirrorStyle }}>
        <video ref={videoRef} autoPlay playsInline muted style={webStyles.layer} />
        <canvas ref={canvasRef} style={webStyles.overlayLayer} />
      </div>
      {/* 상태 안내는 반전되면 안 되므로 mirror 래퍼 바깥에 둔다. */}
      {status === 'loading' ? (
        <div style={webStyles.statusOverlay}>{strings.signInput.cameraLoading}</div>
      ) : null}
      {status === 'error' && error ? <div style={webStyles.statusOverlay}>{error}</div> : null}
    </div>
  );
}

const webStyles: Record<string, React.CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    background: colors.bg.video,
  },
  stage: {
    position: 'absolute',
    inset: 0,
  },
  layer: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    // contain 이다. 가로 프레임을 세로 카드에 cover 로 넣으면 좌우가 잘려 나간다.
    objectFit: 'contain',
  },
  // 오버레이 캔버스는 object-fit 을 쓰지 않는다 — cover 매핑을 overlay.web.ts 가 직접 계산한다.
  overlayLayer: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  statusOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 1.5,
    background: 'rgba(0, 0, 0, 0.4)',
  },
};
