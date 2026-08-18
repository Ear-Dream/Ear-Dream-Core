/**
 * kp130 얼굴 78점의 **부위별 인덱스**.
 *
 * 수어는 비수지신호(눈썹·눈·입모양·고개)가 문법 요소라, 아바타가 얼굴을 표현하려면
 * 78점이 각각 어디인지 알아야 한다. `figure.ts` 가 이 인덱스로 눈·눈썹·입의 크기와
 * 각도를 재므로 여기서 부위를 갈라 둔다.
 *
 * ## 인덱스 정본
 *
 * 서버 `app/ml/keypoint_layout.py` 의 `FACE_MESH_IDS` 구성 순서를 그대로 옮겼다.
 * 그 파일은 쌍 목록을 `[왼쪽, 오른쪽]` 으로 번갈아 펼친 뒤 정중선 6점을 뒤에 붙인다:
 *
 *   k 0..17   입술 바깥 9쌍   k 18..35  입술 안쪽 9쌍
 *   k 36..45  눈썹 5쌍        k 46..69  눈 12쌍
 *   k 70..71  콧볼 1쌍        k 72..77  정중선 6점 (0, 17, 13, 14, 1, 168)
 *
 * 전역 인덱스는 `52 + k` 다 (얼굴 블록이 52 에서 시작).
 *
 * ⚠️ **여기 순서가 틀리면 조용히 이상한 얼굴이 나온다** — 에러가 아니라 표정이
 * 어긋날 뿐이라 알아채기 어렵다. 정본이 바뀌면 같이 고친다.
 *
 * ## 좌우 표기
 *
 * `left`/`right` 는 **MediaPipe 기준(피사체 기준)** 이다. 정면 비미러 영상에서
 * 피사체의 왼쪽 눈(263 계열)은 화면 오른쪽에 찍힌다 — 자산 실측으로 확인했다
 * (263 의 평균 x 가 33 보다 크다).
 */

/** 얼굴 블록 시작 인덱스. `bodyLayout.ts` 의 BLOCKS.face[0] 과 같아야 한다. */
const FACE_BASE = 52;

const g = (k: number) => FACE_BASE + k;

/**
 * 입술 안쪽 링 20점 — MediaPipe 입술 안쪽을 한 바퀴 도는 순서.
 *
 * 지금 쓰는 값은 정중선 두 점(위·아래 입술 안쪽 중앙)뿐이다. 그 둘의 거리가 곧
 * **입이 벌어진 정도**이고, 아바타는 그 값으로 입 도형을 정한다. 나머지 점을 남겨 둔
 * 이유는 순서가 곧 계약이라서다 — 정중선 점의 위치(5번·15번)가 이 배열 순서에서 나온다.
 */
export const LIPS_INNER_RING = [
  19, 21, 23, 25, 27, 75, 26, 24, 22, 20, 18, 28, 30, 32, 34, 74, 35, 33, 31, 29,
].map(g);

/** 눈썹 5점 (안쪽 → 바깥쪽). 올림/찌푸림이 이 곡선의 높이로 나타난다. */
export const RIGHT_BROW = [37, 39, 41, 43, 45].map(g);
export const LEFT_BROW = [36, 38, 40, 42, 44].map(g);

/** 표정·머리 기하를 재는 데 쓰는 낱개 점. */
export const FACE_POINTS = {
  rightEyeOuter: g(47), // 33
  rightEyeInner: g(49), // 133
  rightEyeUpper: g(51), // 159
  rightEyeLower: g(53), // 145
  leftEyeOuter: g(46), // 263
  leftEyeInner: g(48), // 362
  leftEyeUpper: g(50), // 386
  leftEyeLower: g(52), // 374
  mouthCornerRight: g(1), // 61
  mouthCornerLeft: g(0), // 291
  noseTip: g(76), // 1
  noseBridge: g(77), // 168
  noseWingLeft: g(70), // 327
  noseWingRight: g(71), // 98
} as const;
