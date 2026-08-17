/**
 * kp130 레이아웃의 **몸통 쪽 인덱스** — 블록 경계와 포즈 10점.
 *
 * 얼굴 78점의 부위별 인덱스는 `faceLayout.ts` 에 있다. 둘 다 같은 정본
 * (서버 `app/ml/keypoint_layout.py`)에서 왔고, **정본이 바뀌면 같이 고친다.**
 *
 * **MediaPipe 런타임에서 가져오지 않는다.** 이유가 둘이다.
 *
 *   1. 청인 트랙은 카메라를 쓰지 않는다. 좌표를 해석하자고 WASM+모델 55MB 를 받게 할 수 없다.
 *   2. **인덱스가 맞지 않는다.** kp130 의 손 21×2 는 MediaPipe 토폴로지 그대로지만,
 *      포즈는 **10점**(상체 서브셋 + 합성 NECK)이고 얼굴은 **78점 서브셋**이다.
 *      MediaPipe 의 POSE_CONNECTIONS·FACE_LANDMARKS_CONTOURS 인덱스는 여기에 대응하지 않는다.
 */

/** 블록 경계. index.json 의 `format.blocks` 와 같은 값이며, 자산이 정본이다. */
export const BLOCKS = {
  leftHand: [0, 21],
  rightHand: [21, 42],
  pose: [42, 52],
  face: [52, 130],
} as const;

/** 포즈 10점 (keypoint_layout.py 의 상수와 1:1). `neck` 은 양어깨 중점인 합성점이다. */
export const POSE = {
  nose: 42,
  neck: 43,
  leftShoulder: 44,
  rightShoulder: 45,
  leftElbow: 46,
  rightElbow: 47,
  leftWrist: 48,
  rightWrist: 49,
  leftHip: 50,
  rightHip: 51,
} as const;

/**
 * 손 21점의 손가락 마디 순서 (MediaPipe 표준). 블록 안에서의 상대 인덱스다.
 * 0 = 손목이고, 각 배열이 손목에서 손끝으로 이어지는 한 손가락이다.
 */
export const FINGER_CHAINS: readonly (readonly number[])[] = [
  [1, 2, 3, 4], // 엄지
  [5, 6, 7, 8], // 검지
  [9, 10, 11, 12], // 중지
  [13, 14, 15, 16], // 약지
  [17, 18, 19, 20], // 소지
];

/** 손바닥 윤곽 — 손목과 네 손가락 MCP. 이 다섯 점이 손바닥 면이다. */
export const PALM_RING: readonly number[] = [0, 5, 9, 13, 17];
