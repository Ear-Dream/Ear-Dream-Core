/**
 * 손 랜드마크 육안 검증 뷰 — 웹 전용.
 *
 * ⚠️ 개발용 임시 화면이다. 디자인이 확정되기 전까지 좌표가 제대로 뽑히는지 눈으로 확인하는 용도이며,
 * 실제 화면은 나중에 useHandLandmarker 훅만 가져다 새로 만든다. 이 파일은 그때 버려도 된다.
 *
 * 오버레이를 RN View 가 아니라 <canvas> 로 그리는 이유
 *
 * 1. FPS 측정 오염 방지. 점 21개 + 뼈대 21개를 양손이면 약 84개 View 로 그리게 되는데,
 *    이걸 매 프레임 리렌더하면 초당 수천 번의 DOM 변경이 생긴다. 그러면 화면에 뜨는 FPS 가
 *    MediaPipe 처리율이 아니라 React 재조정 비용을 재게 된다. 측정하려는 값이 측정 방법 때문에
 *    왜곡되는 셈이다. 캔버스는 검출 루프와 같은 tick 안에서 그리므로 리렌더가 0회다.
 * 2. 연결선. View 로 선을 그으려면 뼈대마다 길이와 회전 transform 을 계산해야 한다.
 *    캔버스는 moveTo/lineTo 두 줄이다.
 * 3. 재사용의 실체는 훅이지 이 렌더러가 아니다. 네이티브로 갈 때는 어차피 다른 렌더러
 *    (RN View / Skia / 네이티브 오버레이)를 쓰게 되고, 그쪽은 types.ts 의 DetectedHand 를
 *    그대로 받는다. 좌표가 정규화 [0,1] 라 해상도 환산도 필요 없다.
 */
import { useCallback, useRef, useState } from 'react';

import { HANDEDNESS_VERIFIED, PREVIEW_MIRRORED } from './handedness';
import type { HandLandmarkSnapshot } from './types';
import { useHandLandmarker } from './useHandLandmarker.web';
import { getVisionRuntime } from './visionRuntime.web';

// 손별 색. handedness 라벨에 따라 색을 다르게 줘서 어떤 라벨이 붙었는지 눈으로 바로 구분되게 한다.
// 실측에 필요한 정보라 임의의 배색이 아니다.
const HAND_COLORS: Record<string, string> = {
  Left: '#2f6df6',
  Right: '#f6902f',
};
const UNKNOWN_HAND_COLOR = '#9aa0a6';

function drawHands(canvas: HTMLCanvasElement, snapshot: HandLandmarkSnapshot): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  // 뼈대 연결 정보는 라이브러리 상수를 쓴다(직접 정의하지 않는다).
  // 프레임이 오는 시점에는 이미 로드가 끝나 있으므로 여기서는 동기 접근으로 충분하다.
  const connections = getVisionRuntime()?.HandLandmarker.HAND_CONNECTIONS ?? [];

  // 입력 해상도에 맞춰 캔버스 버퍼 크기를 맞춘다. CSS 크기와는 별개다.
  if (canvas.width !== snapshot.sourceWidth || canvas.height !== snapshot.sourceHeight) {
    canvas.width = snapshot.sourceWidth;
    canvas.height = snapshot.sourceHeight;
  }

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);

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

export function CameraLandmarkView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // enabled 를 껐다 켜면 카메라와 검출 루프가 통째로 재시작된다.
  // 권한을 거부했다가 허용으로 바꾼 경우 새로고침 없이 다시 시도하려고 둔다.
  const [enabled, setEnabled] = useState(true);

  // 검출 루프와 같은 tick 안에서 그린다. 이 경로는 React 상태를 건드리지 않는다.
  const handleFrame = useCallback((snapshot: HandLandmarkSnapshot) => {
    const canvas = canvasRef.current;
    if (canvas) drawHands(canvas, snapshot);
  }, []);

  const { status, error, hands, fps, sourceWidth, sourceHeight, videoRef } = useHandLandmarker({
    enabled,
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

      <div style={styles.hud}>
        <div style={styles.hudRow}>
          <strong>상태</strong>
          <span>{status}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>FPS</strong>
          <span>{fps > 0 ? fps.toFixed(1) : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>입력 해상도</strong>
          <span>{sourceWidth > 0 ? `${sourceWidth}x${sourceHeight}` : '—'}</span>
        </div>
        <div style={styles.hudRow}>
          <strong>검출된 손</strong>
          <span>{hands.length}</span>
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

        <button type="button" onClick={restart} style={styles.restart} data-testid="landmark-restart">
          카메라 다시 시작
        </button>

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
  restart: {
    alignSelf: 'flex-start',
    // 터치 타겟 최소 크기(iOS 44pt / Android 48dp). 개발 화면이지만 지킬 이유가 없지 않다.
    minHeight: 44,
    padding: '0 16px',
    marginTop: 4,
    borderRadius: 8,
    border: '1px solid #c4c7c5',
    background: '#fff',
    fontSize: 15,
    cursor: 'pointer',
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
