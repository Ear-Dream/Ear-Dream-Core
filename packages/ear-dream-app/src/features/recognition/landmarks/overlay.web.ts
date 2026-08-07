/**
 * 랜드마크 캔버스 오버레이 그리기 — 웹 전용.
 *
 * CameraLandmarkView.web(개발 확인용)과 SignCameraView.web(수어 입력 화면)이 공유한다.
 * 배색만 소비자마다 다르다: 개발 화면은 handedness 라벨을 눈으로 검증해야 해서 손별 색을 쓰고,
 * 제품 와이어프레임은 카메라 위 가시성용 중립색을 쓴다.
 *
 * 오버레이를 RN View 가 아니라 <canvas> 로 그리는 이유(요약, 상세는 CameraLandmarkView.web.tsx):
 * 매 프레임 수백 개의 DOM 변경 대신 검출 루프와 같은 tick 안에서 리렌더 0회로 그린다.
 */
import type { LandmarkSnapshot } from './types';
import { getVisionRuntime } from './visionRuntime.web';

/**
 * handedness 라벨별 뼈대 색. 개발 화면과 수어 입력 화면이 공유한다.
 * 라벨이 실제 손과 맞는지는 아직 미검증이다(handedness.ts 의 HANDEDNESS_VERIFIED).
 * 색은 "어떤 라벨이 붙었는가"를 보여줄 뿐, 라벨의 정오를 보증하지 않는다.
 */
export const HANDEDNESS_COLORS: Record<string, string> = {
  Left: '#2f6df6',
  Right: '#f6902f',
};
export const UNKNOWN_HAND_COLOR = '#9aa0a6';

export interface OverlayColors {
  /** handedness 라벨("Left"/"Right")별 뼈대 색. 없으면 fallbackHandColor 를 쓴다. */
  handColors?: Record<string, string>;
  fallbackHandColor: string;
  /** 손 관절 점 색. */
  handPointColor: string;
  faceColor: string;
}

function drawHands(
  context: CanvasRenderingContext2D,
  snapshot: LandmarkSnapshot,
  width: number,
  height: number,
  colors: OverlayColors,
): void {
  // 뼈대 연결 정보는 라이브러리 상수를 쓴다(직접 정의하지 않는다).
  // 프레임이 오는 시점에는 이미 로드가 끝나 있으므로 여기서는 동기 접근으로 충분하다.
  const connections = getVisionRuntime()?.HandLandmarker.HAND_CONNECTIONS ?? [];

  for (const hand of snapshot.hands) {
    const color = colors.handColors?.[hand.handednessLabel] ?? colors.fallbackHandColor;

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

    context.fillStyle = colors.handPointColor;
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
  colors: OverlayColors,
): void {
  // 그리는 데는 표시용 값을 쓴다. snapshot.face(관측값)는 건너뛴 프레임에서 null 이라
  // 그대로 그리면 오버레이가 깜빡인다. 대신 재사용된 값은 아래에서 흐리게 표시한다.
  // ⚠️ displayFace 는 여기(그리기)까지만 쓴다 — 버퍼/전송 금지(types.ts 의 face 주석 참고).
  const face = snapshot.displayFace;
  if (!face) return;

  // 윤곽선만 그린다. TESSELATION 은 선이 2,600개가 넘어서 그리는 비용이 검출 비용을 압도한다.
  const connections = getVisionRuntime()?.FaceLandmarker.FACE_LANDMARKS_CONTOURS ?? [];

  // 건너뛴 프레임의 재사용 값이면 흐리게 그린다. 지금 검출된 것과 눈으로 구분되게 하기 위해서다.
  context.save();
  if (snapshot.face !== face) context.globalAlpha = 0.35;

  context.strokeStyle = colors.faceColor;
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
  context.fillStyle = colors.faceColor;
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

/** 한 프레임의 스냅샷을 캔버스에 그린다. 검출 루프와 같은 tick 에서 호출한다(리렌더 없음). */
export function drawSnapshot(
  canvas: HTMLCanvasElement,
  snapshot: LandmarkSnapshot,
  colors: OverlayColors,
): void {
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
  drawFace(context, snapshot, width, height, colors);
  drawHands(context, snapshot, width, height, colors);
}
