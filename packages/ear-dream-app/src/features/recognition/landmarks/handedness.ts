/**
 * MediaPipe 의 handedness 라벨("Left" / "Right") 과 실제 사용자의 손을 잇는 매핑.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️ 현재 값은 전부 미검증(UNVERIFIED)이다. 실측 전까지 맞다는 근거가 없다.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 왜 추측하면 안 되는가
 *
 * MediaPipe 는 "입력 이미지가 거울 반전되어 있지 않다"는 가정 아래 Left/Right 를 붙인다.
 * 그런데 셀프(전면) 카메라 경로에는 뒤집힘이 두 번 끼어들 수 있다.
 *   1. 카메라/OS 가 전면 카메라 프레임을 이미 반전해서 주는 경우
 *   2. 미리보기를 자연스럽게 보이려고 CSS `transform: scaleX(-1)` 로 반전하는 경우 (PREVIEW_MIRRORED)
 * 두 반전이 겹치면 상쇄되고, 하나만 걸리면 라벨이 직관과 정반대로 나온다.
 * 즉 "오른손을 들었으니 Right 가 오는 게 당연하다" 는 추론은 이 파이프라인에서 성립하지 않는다.
 *
 * ## 이 값들이 지금 무엇을 하는가 — 좌우 배정은 서버가 한다
 *
 * 서버가 포즈 손목 기하 매칭으로 손의 좌우를 배정하므로, **프론트에서 라벨을 보정할 필요는
 * 영구히 없어졌다.** 라벨과 score 는 원본 그대로 전송하고 서버의 fallback 으로만 쓰인다.
 * 즉 아래 상수들은 파이프라인을 제어하지 않는다 — **아직 안 끝난 실측을 기록해 둔 자리**다.
 *
 * 그래도 실측이 필요한 이유: 아카이브 데이터를 해석할 때와 서버 fallback 의 신뢰도를
 * 따질 때 근거가 된다. 추측으로 고치지 말고 실측한다.
 *
 * 실측 후 바꾸는 법
 *
 * `pnpm dev:web` 으로 띄우면 화면에 검출된 각 손의 원본 라벨과 score 가 그대로 표시된다.
 * 수어를 할 손(MVP 제약상 오른손)만 들어서 표시되는 라벨을 확인한 뒤,
 * 아래 SIGNING_HAND_LABEL / GRIP_HAND_LABEL 두 줄만 그 결과에 맞게 바꾸면 된다.
 * 그리고 HANDEDNESS_VERIFIED 를 true 로 올린다. 다른 파일은 건드릴 필요가 없다.
 */

/** MediaPipe 가 내보내는 원본 handedness 라벨. */
export type MediaPipeHandednessLabel = 'Left' | 'Right';

/**
 * 미리보기를 좌우 반전해서 보여주는지 여부.
 * 라벨이 뒤집히는 원인 중 하나이므로 라벨 상수와 같은 파일에 둔다.
 * 이 값을 바꾸면 handedness 실측을 다시 해야 한다.
 */
export const PREVIEW_MIRRORED = true;

/**
 * 수어를 하는 손(MVP 제약: 오른손)에 MediaPipe 가 붙이는 라벨.
 * ⚠️ 미검증 추정값. 실측 후 이 줄을 고친다.
 */
export const SIGNING_HAND_LABEL: MediaPipeHandednessLabel = 'Right';

/**
 * 폰을 쥐는 손(MVP 제약: 왼손)에 MediaPipe 가 붙이는 라벨.
 * ⚠️ 미검증 추정값. 실측 후 이 줄을 고친다.
 */
export const GRIP_HAND_LABEL: MediaPipeHandednessLabel = 'Left';

/**
 * 위 두 라벨이 실측으로 확인되었는지.
 * 실측 전까지 false 로 두고, UI 는 이 값을 보고 "미검증" 경고를 띄운다.
 */
export const HANDEDNESS_VERIFIED = false;
