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
import type { LandmarkerDelegate, LandmarkSnapshot } from './types';
import { useLandmarker } from './useLandmarker.web';
import { getVisionRuntime } from './visionRuntime.web';

// 손별 색. handedness 라벨에 따라 색을 다르게 줘서 어떤 라벨이 붙었는지 눈으로 바로 구분되게 한다.
// 실측에 필요한 정보라 임의의 배색이 아니다.
const HAND_COLORS: Record<string, string> = {
  Left: '#2f6df6',
  Right: '#f6902f',
};
const UNKNOWN_HAND_COLOR = '#9aa0a6';
// 얼굴은 손과 확실히 구분되는 색으로 둔다. 손 위에 얼굴 점이 겹쳐 보여도 헷갈리지 않게.
const FACE_COLOR = '#31c48d';

/** 개발 화면에서 골라볼 수 있는 얼굴 검출 주기. 확정값이 아니라 비교용 선택지다. */
const FACE_INTERVAL_CHOICES = [1, 2, 3] as const;

function drawHands(
  context: CanvasRenderingContext2D,
  snapshot: LandmarkSnapshot,
  width: number,
  height: number,
): void {
  // 뼈대 연결 정보는 라이브러리 상수를 쓴다(직접 정의하지 않는다).
  // 프레임이 오는 시점에는 이미 로드가 끝나 있으므로 여기서는 동기 접근으로 충분하다.
  const connections = getVisionRuntime()?.HandLandmarker.HAND_CONNECTIONS ?? [];

  for (const hand of snapshot.hands) {
    const color = HAND_COLORS[hand.handednessLabel] ?? UNKNOWN_HAND_COLOR;

    context.strokeStyle = color;
    context.lineWidth = Math.max(2, width / 320);
    context.beginPath();
    for (const connection of connections) {
      const from = hand.landmarks[connection.start];
      const to = hand.landmarks[connection.end];
      if (!from || !to) continue;
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
    }
    context.stroke();

    context.fillStyle = '#ffffff';
    const radius = Math.max(3, width / 220);
    for (const point of hand.landmarks) {
      context.beginPath();
      context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
}

function drawFace(
  context: CanvasRenderingContext2D,
  snapshot: LandmarkSnapshot,
  width: number,
  height: number,
): void {
  // 그리는 데는 표시용 값을 쓴다. snapshot.face(관측값)는 건너뛴 프레임에서 null 이라
  // 그대로 그리면 오버레이가 깜빡인다. 대신 재사용된 값은 아래에서 흐리게 표시한다.
  const face = snapshot.displayFace;
  if (!face) return;

  // 윤곽선만 그린다. TESSELATION 은 선이 2,600개가 넘어서 그리는 비용이 검출 비용을 압도하고,
  // 그러면 화면의 FPS 가 "얼굴 검출이 얼마나 무거운가" 가 아니라 "메쉬를 그리는 게 얼마나 무거운가"
  // 를 재게 된다. 작업 지시서도 얼굴은 점만 찍어도 충분하다고 본다.
  const connections = getVisionRuntime()?.FaceLandmarker.FACE_LANDMARKS_CONTOURS ?? [];

  // 건너뛴 프레임의 재사용 값이면 흐리게 그린다. 지금 검출된 것과 눈으로 구분되게 하기 위해서다.
  context.save();
  if (snapshot.face !== face) context.globalAlpha = 0.35;

  context.strokeStyle = FACE_COLOR;
  context.lineWidth = Math.max(1, width / 640);
  context.beginPath();
  for (const connection of connections) {
    const from = face.landmarks[connection.start];
    const to = face.landmarks[connection.end];
    if (!from || !to) continue;
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
  }
  context.stroke();

  // 점 478개를 개별 path 로 그리면 그리기 비용이 눈에 띈다. 하나의 path 에 모아 한 번만 채운다.
  const radius = Math.max(1, width / 900);
  context.fillStyle = FACE_COLOR;
  context.beginPath();
  for (const point of face.landmarks) {
    const x = point.x * width;
    const y = point.y * height;
    context.moveTo(x + radius, y);
    context.arc(x, y, radius, 0, Math.PI * 2);
  }
  context.fill();

  context.restore();
}

function draw(canvas: HTMLCanvasElement, snapshot: LandmarkSnapshot): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  // 입력 해상도에 맞춰 캔버스 버퍼 크기를 맞춘다. CSS 크기와는 별개다.
  if (canvas.width !== snapshot.sourceWidth || canvas.height !== snapshot.sourceHeight) {
    canvas.width = snapshot.sourceWidth;
    canvas.height = snapshot.sourceHeight;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

  // 얼굴을 먼저 그린다. 손이 얼굴 앞을 지날 때 손이 위에 오는 게 자연스럽다.
  drawFace(context, snapshot, width, height);
  drawHands(context, snapshot, width, height);
}

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
    if (canvas) draw(canvas, snapshot);
  }, []);

  const {
    status,
    error,
    hands,
    face,
    displayFace,
    fps,
    timings,
    delegate: activeDelegate,
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
        <div style={styles.hudRow}>
          <strong>손 검출 시간</strong>
          <span>{timings.handDetectMs > 0 ? `${timings.handDetectMs.toFixed(1)}ms` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>얼굴 검출 시간</strong>
          <span>{timings.faceDetectMs > 0 ? `${timings.faceDetectMs.toFixed(1)}ms` : '—'}</span>
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

        {hands.map((hand, index) => (
          <div
            key={`${hand.handednessLabel}-${index}`}
            style={{
              ...styles.handRow,
              borderLeftColor: HAND_COLORS[hand.handednessLabel] ?? UNKNOWN_HAND_COLOR,
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
