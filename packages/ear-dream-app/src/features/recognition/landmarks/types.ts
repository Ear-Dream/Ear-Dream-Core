/**
 * 손 랜드마크 추출의 플랫폼 중립 계약.
 *
 * 이 파일에는 MediaPipe 나 DOM 타입이 등장하지 않는다. 지금은 브라우저 WASM 으로 구현하지만
 * 나중에 development build 의 네이티브 MediaPipe 나 서버 추론으로 갈아끼울 때, 소비하는 쪽
 * (화면, 오버레이) 을 다시 짜지 않아도 되게 하기 위해서다. 구현체가 무엇이든 이 형태만 맞추면 된다.
 */
import type { HandFrame } from '@ear-dream/core';

/** 정규화 좌표. x, y 는 이미지 기준 [0, 1]. z 는 손목 기준 상대 깊이(단위 없음). */
export interface HandLandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/** 검출된 손 하나. T-03 은 양손을 모두 내보내고, 어느 손을 쓸지는 고르지 않는다(T-04). */
export interface DetectedHand {
  /**
   * MediaPipe 원본 라벨("Left" / "Right"). 의미 해석은 handedness.ts 에서만 한다.
   * 여기서 임의로 뒤집거나 보정하지 않는다 — 실측 대상이므로 원본 그대로 전달한다.
   */
  handednessLabel: string;
  /** 위 라벨의 신뢰도 [0, 1]. */
  handednessScore: number;
  /** 21개 관절. 오버레이 등 화면 표시에 쓴다. */
  landmarks: readonly HandLandmarkPoint[];
  /**
   * `@ear-dream/core` 의 HandFrame(21 x [x, y, z]) 과 동일한 형태.
   * 프레임을 모으면 LandmarkWindow 가 되고 그대로 RecognizeRequest.window 로 보낼 수 있다.
   */
  frame: HandFrame;
}

/** 한 프레임의 검출 결과. 렌더러가 프레임마다 읽는 값. */
export interface HandLandmarkSnapshot {
  hands: readonly DetectedHand[];
  /** 최근 프레임 이동평균 FPS. 개발 중 확인용. */
  fps: number;
  /** 해당 프레임의 단조증가 타임스탬프(ms). */
  timestampMs: number;
  /** 입력 영상의 실제 해상도. 오버레이 좌표 환산에 쓴다. */
  sourceWidth: number;
  sourceHeight: number;
}

export type HandLandmarkerStatus =
  /** 아직 시작 안 함 (enabled=false). */
  | 'idle'
  /** 모델/WASM 로드 또는 카메라 권한 대기. */
  | 'loading'
  /** 검출 루프 동작 중. */
  | 'running'
  /** 실패. error 에 사유가 들어간다. */
  | 'error'
  /** 이 플랫폼에서 지원하지 않음 (현재 네이티브). */
  | 'unsupported';

export interface UseHandLandmarkerOptions {
  /** false 면 카메라와 검출 루프를 모두 정지한다. 기본값 true. */
  enabled?: boolean;
  /**
   * 매 프레임 호출된다. 리렌더 없이 그리고 싶은 렌더러(캔버스 등)가 쓴다.
   * 함수 신원이 매 렌더 바뀌어도 루프는 재시작되지 않는다.
   */
  onFrame?: (snapshot: HandLandmarkSnapshot) => void;
}

export interface UseHandLandmarkerResult {
  status: HandLandmarkerStatus;
  /** 사용자에게 보여줄 수 있는 실패 사유. status !== 'error' 면 null. */
  error: string | null;
  /**
   * 표시용 스냅샷. 매 프레임이 아니라 HUD_UPDATE_INTERVAL_MS 주기로만 갱신된다.
   * 프레임마다 리렌더가 필요하면 onFrame 을 쓴다.
   */
  hands: readonly DetectedHand[];
  fps: number;
  /** 입력 영상 해상도. 아직 모르면 0. */
  sourceWidth: number;
  sourceHeight: number;
}
