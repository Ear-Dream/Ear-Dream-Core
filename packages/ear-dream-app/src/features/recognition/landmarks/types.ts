/**
 * 랜드마크 추출(손 + 얼굴)의 플랫폼 중립 계약.
 *
 * 이 파일에는 MediaPipe 나 DOM 타입이 등장하지 않는다. 지금은 브라우저 WASM 으로 구현하지만
 * 나중에 development build 의 네이티브 MediaPipe 나 서버 추론으로 갈아끼울 때, 소비하는 쪽
 * (화면, 오버레이) 을 다시 짜지 않아도 되게 하기 위해서다. 구현체가 무엇이든 이 형태만 맞추면 된다.
 */
import type { HandFrame } from '@ear-dream/core';

/** 정규화 좌표. x, y 는 이미지 기준 [0, 1]. z 는 기준점 상대 깊이(단위 없음). */
export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * 얼굴 메쉬 1프레임. HandFrame(21 x [x, y, z]) 과 같은 표현을 쓴다 — 점 개수만 다르다.
 *
 * `@ear-dream/core` 가 아니라 여기 두는 이유: 아직 **앱 밖에 소비자가 없다**.
 * core 의 `HandFrame` 은 생성된 `RecognizeRequest.window` 원소에 붙인 가독성 별칭이고,
 * `Message` 계열은 클라이언트 로컬 상태라고 명시되어 있다. `FaceFrame` 은 아직 둘 중 어느 쪽도
 * 아니라서, 지금 core 에 올리면 서버와 합의되지 않은 형태가 공유 패키지에 먼저 굳는다.
 * 얼굴을 실제로 전송하게 되는 시점(T-07 / T-08)에 Pydantic 스키마에 추가하고
 * `pnpm generate:api-types` 로 내려받아 이 타입을 대체한다.
 *
 * ⚠️ 그때 주의할 것: `FaceFrame` 과 `HandFrame` 은 둘 다 `number[][]` 라 구조적으로 동일해서
 * 서로 바꿔 넣어도 타입 검사가 통과한다. 요청에 손과 얼굴이 함께 들어가는 순간 실제 위험이 되므로,
 * 스키마에서 위치가 아니라 이름 있는 필드(`hands`, `face`)로 감싸 실수를 막을 것.
 */
export type FaceFrame = number[][];

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
  landmarks: readonly LandmarkPoint[];
  /**
   * `@ear-dream/core` 의 HandFrame(21 x [x, y, z]) 과 동일한 형태.
   * 프레임을 모으면 LandmarkWindow 가 되고 그대로 RecognizeRequest.window 로 보낼 수 있다.
   */
  frame: HandFrame;
}

/**
 * 검출된 얼굴 하나.
 *
 * 수어에서 비수지신호(눈썹·시선·입모양·고개 방향)는 장식이 아니라 문법 요소다. 같은 손 동작이라도
 * 표정으로 의문문·부정이 갈리므로 손만 뽑으면 그 구분이 애초에 불가능하다.
 * T-03 은 원본 메쉬를 그대로 내보내기만 하고, 어느 지점을 쓸지 고르는 것은 T-04 에서 한다.
 */
export interface DetectedFace {
  /** 메쉬 점(모델 구성에 따라 468 또는 478 — iris 포함 시 478). 개수를 코드에 박지 않는다. */
  landmarks: readonly LandmarkPoint[];
  /** HandFrame 과 같은 표현의 좌표 배열. 축약 없이 원본 그대로다. */
  frame: FaceFrame;
}

/** 추론 백엔드. 지정하지 않으면 라이브러리 기본값인 CPU 로 돈다. config.ts 참고. */
export type LandmarkerDelegate = 'GPU' | 'CPU';

/**
 * 단계별 처리 시간(ms) 이동평균.
 *
 * 얼굴을 추가하면 프레임 처리율이 떨어진다. 떨어진 만큼이 체감 지연을 해치는지 판단하려면
 * 총 FPS 만으로는 부족하고 어느 단계가 얼마를 먹는지가 필요하다. 개발 화면 표시용이다.
 */
export interface LandmarkTimings {
  handDetectMs: number;
  /** 얼굴 검출을 실제로 수행한 프레임들의 평균. 꺼져 있으면 0. */
  faceDetectMs: number;
}

/** 한 프레임의 검출 결과. 렌더러가 프레임마다 읽는 값. */
export interface LandmarkSnapshot {
  hands: readonly DetectedHand[];
  /**
   * **이 프레임에서 실제로 검출된** 얼굴. 관측이 없으면 null이다.
   * 검출을 건너뛴 프레임(FACE_DETECT_EVERY_N_FRAMES > 1)도, 얼굴이 프레임 밖으로 나간 경우도 null.
   *
   * 서버로 보낼 값은 반드시 이쪽이다. displayFace 를 대신 쓰면 안 된다 — 직전 값 유지는
   * 결측치 대치(imputation)이고, 대치 정책은 서버 전처리 한 곳에만 있어야 한다(설계 결정 1).
   * 프론트가 조용히 메운 프레임과 진짜 관측을 서버가 구분할 수 없게 되면, 증상이
   * "학습은 잘 됐는데 실사용은 틀림" 으로 나타나 원인 추적이 매우 어려워진다.
   * 참고로 T-04 는 짧은 결측을 hold 가 아니라 **선형 보간**으로 메우도록 지시하고 있다.
   */
  face: DetectedFace | null;
  /**
   * 화면 표시 전용. 건너뛴 프레임에서는 직전 검출값을 그대로 들고 있어서 오버레이가 깜빡이지 않는다.
   * `displayFace !== face` 면 그 프레임의 표시값은 재사용된 값이다.
   * ⚠️ 이 값을 버퍼에 쌓거나 전송하지 말 것. 위 face 주석 참고.
   */
  displayFace: DetectedFace | null;
  /** 최근 프레임 이동평균 FPS. 개발 중 확인용. */
  fps: number;
  timings: LandmarkTimings;
  /** 해당 프레임의 단조증가 타임스탬프(ms). */
  timestampMs: number;
  /** 입력 영상의 실제 해상도. 오버레이 좌표 환산에 쓴다. */
  sourceWidth: number;
  sourceHeight: number;
}

export type LandmarkerStatus =
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

export interface UseLandmarkerOptions {
  /** false 면 카메라와 검출 루프를 모두 정지한다. 기본값 true. */
  enabled?: boolean;
  /**
   * 얼굴 메쉬 추출 여부. 기본값 true.
   * 끄면 손만 처리한다 — 손만 / 손+얼굴 처리율을 같은 카메라 세션 안에서 비교하기 위한 스위치다.
   * 값을 바꿔도 카메라와 검출 루프는 재시작되지 않는다.
   */
  faceEnabled?: boolean;
  /**
   * 얼굴을 몇 프레임마다 한 번 검출할지. 기본값은 config.ts 의 FACE_DETECT_EVERY_N_FRAMES(=1).
   * 1 보다 크면 건너뛴 프레임에서는 직전 얼굴을 그대로 재사용하고 faceIsFresh 가 false 가 된다.
   */
  faceDetectEveryNFrames?: number;
  /**
   * 추론 백엔드. 기본값은 config.ts 의 LANDMARKER_DELEGATE(='GPU').
   * enabled 와 달리 이 값을 바꾸면 모델을 다시 만들어야 하므로 카메라까지 재시작된다.
   * GPU 생성이 실패하면 CPU 로 폴백하며, 실제로 적용된 값은 결과의 delegate 로 확인한다.
   */
  delegate?: LandmarkerDelegate;
  /**
   * 매 프레임 호출된다. 리렌더 없이 그리고 싶은 렌더러(캔버스 등)가 쓴다.
   * 함수 신원이 매 렌더 바뀌어도 루프는 재시작되지 않는다.
   */
  onFrame?: (snapshot: LandmarkSnapshot) => void;
}

export interface UseLandmarkerResult {
  status: LandmarkerStatus;
  /** 사용자에게 보여줄 수 있는 실패 사유. status !== 'error' 면 null. */
  error: string | null;
  /**
   * 표시용 스냅샷. 매 프레임이 아니라 HUD_UPDATE_INTERVAL_MS 주기로만 갱신된다.
   * 프레임마다 리렌더가 필요하면 onFrame 을 쓴다.
   */
  hands: readonly DetectedHand[];
  face: DetectedFace | null;
  displayFace: DetectedFace | null;
  fps: number;
  timings: LandmarkTimings;
  /**
   * 실제로 적용된 추론 백엔드. 로드 전이면 null.
   * 요청값과 다를 수 있다(GPU 실패 시 CPU 폴백). FPS 를 기록할 때 반드시 함께 적는다.
   */
  delegate: LandmarkerDelegate | null;
  /** 입력 영상 해상도. 아직 모르면 0. */
  sourceWidth: number;
  sourceHeight: number;
}
