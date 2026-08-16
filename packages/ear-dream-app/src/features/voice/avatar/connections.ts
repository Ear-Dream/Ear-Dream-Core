/**
 * kp130 레이아웃의 스켈레톤 연결선.
 *
 * **MediaPipe 런타임에서 가져오지 않는다.** 이유가 둘이다.
 *
 *   1. 청인 트랙은 카메라를 쓰지 않는다. 선을 긋자고 WASM+모델 55MB 를 받게 할 수 없다.
 *   2. **인덱스가 맞지 않는다.** kp130 의 손 21×2 는 MediaPipe 토폴로지 그대로지만,
 *      포즈는 **10점**(상체 서브셋 + 합성 NECK)이고 얼굴은 **78점 서브셋**이다.
 *      MediaPipe 의 POSE_CONNECTIONS·FACE_LANDMARKS_CONTOURS 인덱스는 여기에 대응하지 않는다.
 *
 * 인덱스 정본은 서버 `app/ml/keypoint_layout.py` 다. 아래 상수는 그 파일의
 * NOSE/NECK/L_SHOULDER… 정의를 그대로 옮긴 것이다 — 정본이 바뀌면 여기도 같이 고친다.
 */

/** 블록 경계. index.json 의 `format.blocks` 와 같은 값이며, 자산이 정본이다. */
export const BLOCKS = {
  leftHand: [0, 21],
  rightHand: [21, 42],
  pose: [42, 52],
  face: [52, 130],
} as const;

// ---- 포즈 10점 (keypoint_layout.py 의 상수와 1:1)
const NOSE = 42;
const NECK = 43; // 합성점 — 양어깨 중점
const L_SHOULDER = 44;
const R_SHOULDER = 45;
const L_ELBOW = 46;
const R_ELBOW = 47;
const L_WRIST = 48;
const R_WRIST = 49;
const L_HIP = 50;
const R_HIP = 51;

/** 상체 골격. 목–어깨–팔–몸통. */
export const POSE_EDGES: readonly (readonly [number, number])[] = [
  [NOSE, NECK],
  [NECK, L_SHOULDER],
  [NECK, R_SHOULDER],
  [L_SHOULDER, L_ELBOW],
  [L_ELBOW, L_WRIST],
  [R_SHOULDER, R_ELBOW],
  [R_ELBOW, R_WRIST],
  [L_SHOULDER, L_HIP],
  [R_SHOULDER, R_HIP],
  [L_HIP, R_HIP],
];

/**
 * 손 21점 토폴로지 (MediaPipe 표준). 블록 안에서의 상대 인덱스다.
 * 0 = 손목, 이후 엄지·검지·중지·약지·소지 각 4마디.
 */
const HAND_EDGES_LOCAL: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // 엄지
  [0, 5], [5, 6], [6, 7], [7, 8], // 검지
  [0, 9], [9, 10], [10, 11], [11, 12], // 중지
  [0, 13], [13, 14], [14, 15], [15, 16], // 약지
  [0, 17], [17, 18], [18, 19], [19, 20], // 소지
  [5, 9], [9, 13], [13, 17], // 손바닥 가로
];

const shift = (
  edges: readonly (readonly [number, number])[],
  offset: number,
): (readonly [number, number])[] => edges.map(([a, b]) => [a + offset, b + offset] as const);

export const LEFT_HAND_EDGES = shift(HAND_EDGES_LOCAL, BLOCKS.leftHand[0]);
export const RIGHT_HAND_EDGES = shift(HAND_EDGES_LOCAL, BLOCKS.rightHand[0]);

/**
 * 얼굴 78점은 **선을 긋지 않고 점만 찍는다.**
 *
 * 78점은 478점 메쉬에서 고른 서브셋이라 원본 인덱스를 되짚어야 윤곽(입술·눈썹·눈)을
 * 이을 수 있는데, 그 매핑은 `keypoint_layout.py` 안에서 미러 증강용으로만 쓰이고
 * 그리기용 그룹으로 정리돼 있지 않다. 잘못 이으면 얼굴을 가로지르는 선이 생겨
 * **없는 정보를 있는 것처럼 보이게 한다** — 점만 찍는 편이 정직하다.
 * 표정을 선으로 보여줄 필요가 생기면 그때 정본에서 그룹을 뽑아 온다.
 */
export const FACE_POINT_RANGE = BLOCKS.face;
