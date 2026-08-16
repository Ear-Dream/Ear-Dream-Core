/**
 * 손 · 얼굴 랜드마크 육안 검증 뷰 — 웹 전용.
 *
 * ⚠️ 개발용 임시 화면이다. 디자인이 확정되기 전까지 좌표가 제대로 뽑히는지 눈으로 확인하는 용도이며,
 * 실제 화면은 나중에 useLandmarker 훅만 가져다 새로 만든다. 이 파일은 그때 버려도 된다.
 *
 * 오버레이를 RN View 가 아니라 <canvas> 로 그리는 이유
 *
 * 1. FPS 측정 오염 방지. 손만 해도 점 21개 + 뼈대 21개를 양손이면 약 84개 View 로 그리게 되는데,
 *    얼굴 메쉬 478점까지 더하면 매 프레임 수백 개의 DOM 변경이 생긴다. 그러면 화면에 뜨는 FPS 가
 *    MediaPipe 처리율이 아니라 React 재조정 비용을 재게 된다. 측정하려는 값이 측정 방법 때문에
 *    왜곡되는 셈이다. 캔버스는 검출 루프와 같은 tick 안에서 그리므로 리렌더가 0회다.
 * 2. 연결선. View 로 선을 그으려면 뼈대마다 길이와 회전 transform 을 계산해야 한다.
 *    캔버스는 moveTo/lineTo 두 줄이다.
 * 3. 재사용의 실체는 훅이지 이 렌더러가 아니다. 네이티브로 갈 때는 어차피 다른 렌더러
 *    (RN View / Skia / 네이티브 오버레이)를 쓰게 되고, 그쪽은 types.ts 의 DetectedHand /
 *    DetectedFace 를 그대로 받는다. 좌표가 정규화 [0,1] 라 해상도 환산도 필요 없다.
 */
import { useCallback, useRef, useState } from 'react';

import { FACE_DETECT_EVERY_N_FRAMES, LANDMARKER_DELEGATE } from './config';
import { HANDEDNESS_VERIFIED, PREVIEW_MIRRORED } from './handedness';
import type { OverlayColors } from './overlay.web';
import { drawSnapshot, HANDEDNESS_COLORS, UNKNOWN_HAND_COLOR } from './overlay.web';
import type { LandmarkerDelegate, LandmarkSnapshot } from './types';
import { useLandmarker } from './useLandmarker.web';

// 개발 화면 오버레이 배색. 얼굴은 손과 확실히 구분되는 색으로 둔다.
// 손별 색(HANDEDNESS_COLORS)은 제품 화면과 공유한다 — overlay.web.ts 참고.
const DEV_OVERLAY_COLORS: OverlayColors = {
  handColors: HANDEDNESS_COLORS,
  fallbackHandColor: UNKNOWN_HAND_COLOR,
  handPointColor: '#ffffff',
  faceColor: '#31c48d',
  poseColor: '#e8b12f',
};

/** 개발 화면에서 골라볼 수 있는 얼굴 검출 주기. 확정값이 아니라 비교용 선택지다. */
const FACE_INTERVAL_CHOICES = [1, 2, 3] as const;

export function CameraLandmarkView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // enabled 를 껐다 켜면 카메라와 검출 루프가 통째로 재시작된다.
  // 권한을 거부했다가 허용으로 바꾼 경우 새로고침 없이 다시 시도하려고 둔다.
  const [enabled, setEnabled] = useState(true);
  // 아래 두 값은 카메라를 재시작하지 않고 바뀐다. 같은 세션 안에서 바꿔야 FPS 비교가 성립한다.
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [faceInterval, setFaceInterval] = useState<number>(FACE_DETECT_EVERY_N_FRAMES);
  // 백엔드는 모델 생성 시점 선택이라 바꾸면 카메라까지 재시작된다.
  // 그래도 토글을 두는 이유는 CPU/GPU 가 그 자체로 FPS 측정 축이기 때문이다(config.ts 참고).
  const [delegate, setDelegate] = useState<LandmarkerDelegate>(LANDMARKER_DELEGATE);

  // 검출 루프와 같은 tick 안에서 그린다. 이 경로는 React 상태를 건드리지 않는다.
  const handleFrame = useCallback((snapshot: LandmarkSnapshot) => {
    const canvas = canvasRef.current;
    if (canvas) drawSnapshot(canvas, snapshot, DEV_OVERLAY_COLORS);
  }, []);

  const {
    status,
    error,
    hands,
    face,
    displayFace,
    pose,
    fps,
    timings,
    delegate: activeDelegate,
    gpuCanvasFallback,
    sourceWidth,
    sourceHeight,
    videoRef,
  } = useLandmarker({
    enabled,
    faceEnabled,
    faceDetectEveryNFrames: faceInterval,
    delegate,
    onFrame: handleFrame,
  });

  const restart = useCallback(() => {
    setEnabled(false);
    // 다음 tick 에 다시 켠다. 정리(cleanup)가 끝난 뒤 새로 시작하게 하기 위해서다.
    setTimeout(() => setEnabled(true), 0);
  }, []);

  // 미리보기 반전은 video 와 canvas 를 함께 감싼 래퍼에 건다.
  // 따로 걸면 좌표가 어긋나고, 반전 여부는 handedness 라벨 해석에 직결되므로 handedness.ts 가 소유한다.
  const mirrorStyle: React.CSSProperties = PREVIEW_MIRRORED ? { transform: 'scaleX(-1)' } : {};

  return (
    <div style={styles.root}>
      <div style={{ ...styles.stage, ...mirrorStyle }}>
        <video ref={videoRef} autoPlay playsInline muted style={styles.layer} />
        <canvas ref={canvasRef} style={styles.layer} />
      </div>

      <div style={styles.controls}>
        <button
          type="button"
          onClick={() => setFaceEnabled((on) => !on)}
          style={styles.button}
          data-testid="landmark-toggle-face"
        >
          얼굴 검출 {faceEnabled ? '끄기' : '켜기'}
        </button>

        <div style={styles.intervalGroup}>
          <span style={styles.intervalLabel}>얼굴 주기</span>
          {FACE_INTERVAL_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={!faceEnabled}
              onClick={() => setFaceInterval(choice)}
              style={{
                ...styles.button,
                ...(faceInterval === choice ? styles.buttonActive : null),
                ...(faceEnabled ? null : styles.buttonDisabled),
              }}
            >
              {choice === 1 ? '매 프레임' : `${choice}프레임마다`}
            </button>
          ))}
        </div>

        <div style={styles.intervalGroup}>
          <span style={styles.intervalLabel}>백엔드</span>
          {(['GPU', 'CPU'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setDelegate(choice)}
              style={{ ...styles.button, ...(delegate === choice ? styles.buttonActive : null) }}
            >
              {choice}
            </button>
          ))}
        </div>

        <button type="button" onClick={restart} style={styles.button} data-testid="landmark-restart">
          카메라 다시 시작
        </button>
      </div>

      <div style={styles.hud}>
        <div style={styles.hudRow}>
          <strong>상태</strong>
          <span>{status}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>FPS</strong>
          <span>{fps > 0 ? fps.toFixed(1) : '—'}</span>
        </div>
        {/* 어느 백엔드로 잰 숫자인지 모르는 FPS 기록은 근거가 되지 못한다. 반드시 함께 적는다. */}
        <div style={styles.hudRow}>
          <strong>백엔드(실제)</strong>
          <span>
            {activeDelegate ?? '—'}
            {activeDelegate && activeDelegate !== delegate ? ` (${delegate} 실패 → 폴백)` : ''}
          </span>
        </div>
        {/* GPU 가 그냥 됐는지, 워크어라운드가 있어야 됐는지는 실기기 진단에서 다른 정보다.
            발동한 경우에만 보여준다 — 데스크톱에서는 이 줄이 뜨지 않는 게 정상이다. */}
        {gpuCanvasFallback ? (
          <div style={styles.hudRow}>
            <strong>GPU 캔버스 워크어라운드</strong>
            <span>적용됨 (기본 GPU 생성 실패)</span>
          </div>
        ) : null}
        <div style={styles.hudRow}>
          <strong>손 검출 시간</strong>
          <span>{timings.handDetectMs > 0 ? `${timings.handDetectMs.toFixed(1)}ms` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>얼굴 검출 시간</strong>
          <span>{timings.faceDetectMs > 0 ? `${timings.faceDetectMs.toFixed(1)}ms` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>포즈 검출 시간</strong>
          <span>{timings.poseDetectMs > 0 ? `${timings.poseDetectMs.toFixed(1)}ms` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>입력 해상도</strong>
          <span>{sourceWidth > 0 ? `${sourceWidth}x${sourceHeight}` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>검출된 손</strong>
          <span>{hands.length}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>검출된 얼굴</strong>
          <span>
            {/* 검출이 돌지 않는 동안 "0 — 프레임 밖" 으로 보이면 프레이밍 판정을 오해하게 된다. */}
            {status !== 'running'
              ? '—'
              : !faceEnabled
                ? '꺼짐'
                : displayFace
                  ? `1 (${displayFace.landmarks.length}점)${face ? '' : ' — 유지값'}`
                  : '0 — 프레임 밖'}
          </span>
        </div>
        <div style={styles.hudRow}>
          <strong>검출된 포즈(어깨)</strong>
          <span>
            {status !== 'running'
              ? '—'
              : pose
                ? `1 (${pose.landmarks.length}점)`
                : '0 — 어깨가 프레임 밖'}
          </span>
        </div>

        {hands.map((hand, index) => (
          <div
            key={`${hand.handednessLabel}-${index}`}
            style={{
              ...styles.handRow,
              borderLeftColor: HANDEDNESS_COLORS[hand.handednessLabel] ?? UNKNOWN_HAND_COLOR,
            }}
          >
            <strong>{hand.handednessLabel}</strong>
            <span>score {hand.handednessScore.toFixed(3)}</span>
            <span>{hand.landmarks.length}점</span>
          </div>
        ))}

        {error ? <p style={styles.error}>{error}</p> : null}

        {!HANDEDNESS_VERIFIED ? (
          <p style={styles.warning}>
            <strong>handedness 미검증.</strong> 위 라벨이 실제 손과 맞는지 아직 확인되지 않았다.
            한쪽 손만 들어서 어떤 라벨이 붙는지 확인한 뒤,
            <code> src/features/recognition/landmarks/handedness.ts </code>
            의 SIGNING_HAND_LABEL / GRIP_HAND_LABEL 을 결과에 맞게 고치고 HANDEDNESS_VERIFIED 를 true 로 바꿔라.
            추측으로 정하면 T-04 이후가 전부 반대로 동작한다.
          </p>
        ) : null}

        <p style={styles.warning}>
          <strong>프레이밍 실측 필요.</strong> 왼손으로 폰을 쥔 자세에서는 카메라가 얼굴보다 아래를
          향하기 쉽다. 그 자세로 위 &ldquo;검출된 얼굴&rdquo; 이 계속 1 로 유지되는지 확인한다.
          0 으로 떨어지면 T-02 가이드 오버레이 위치를 조정해야 한다.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    maxWidth: 720,
  },
  stage: {
    position: 'relative',
    width: '100%',
    aspectRatio: '4 / 3',
    background: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  intervalGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  intervalLabel: {
    fontSize: 14,
    color: '#444',
  },
  hud: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 12,
    borderRadius: 12,
    background: '#f1f3f4',
    fontSize: 14,
    lineHeight: 1.5,
  },
  hudRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
  },
  handRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 8,
    borderLeftWidth: 4,
    borderLeftStyle: 'solid',
  },
  error: {
    margin: 0,
    color: '#b3261e',
  },
  button: {
    // 터치 타겟 최소 크기(iOS 44pt / Android 48dp). 개발 화면이지만 지킬 이유가 없지 않다.
    minHeight: 44,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid #c4c7c5',
    background: '#fff',
    fontSize: 15,
    cursor: 'pointer',
  },
  buttonActive: {
    borderColor: '#1a73e8',
    background: '#e8f0fe',
    fontWeight: 600,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  warning: {
    margin: 0,
    padding: 8,
    borderRadius: 8,
    background: '#fff4e5',
    color: '#7a4100',
    fontSize: 13,
  },
};
