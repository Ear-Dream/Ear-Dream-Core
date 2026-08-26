/**
 * 좌표 → 그릴 도형. 아바타의 **형상 모델**이다.
 *
 * `AvatarPlayer` 는 이 파일이 만든 `Figure` 를 SVG 로 옮기기만 한다 — "무엇을
 * 그리는가" 는 여기서 끝나고 "어떻게 칠하는가" 만 저쪽에 남는다. React 에 의존하지
 * 않는 순수 함수라 화면 없이도 값을 검사할 수 있다.
 *
 * ## 얼굴 — 도형은 고정, 값은 데이터
 *
 * 실측 랜드마크를 그대로 이어 눈·입을 그리면 화면에서 눈이 몇 픽셀짜리라 미세한
 * 비대칭이 전부 "찌푸린 인상" 으로 읽힌다. 그래서 도형은 단순하게 고정하고 데이터는
 * 그 도형의 크기·각도만 정한다 — 깜빡임·눈썹 올림·입 벌림은 살아 있고 인상만 정돈된다.
 *
 * ## 크기는 전부 상대값
 *
 * 어깨 너비(`unit`)와 눈 간격(`eyeSpan`) 기준으로만 계산한다. 픽셀 상수로 두면 화면
 * 크기나 인물 거리가 바뀔 때 비율이 깨진다. 실제 배율은 `avatarTuning` 에 있다.
 */
import { BLOCKS, FINGER_CHAINS, PALM_RING, POSE } from './bodyLayout';
import {
  CROP_MARGIN,
  EYE,
  FACE_ANIMATED,
  HAND,
  HEAD,
  LIMB,
  MOUTH,
  OUTLINE_WIDTH,
} from './avatarTuning';
import { FACE_POINTS, LEFT_BROW, LIPS_INNER_RING, RIGHT_BROW } from './faceLayout';
import type { EyeState, MouthState } from './avatarSprites';
import type { At, Point } from './geometry';
import { convexHull, median, ok, pt, smoothRing, span, taper } from './geometry';
import type { SignSequence } from './sequenceFiles';
import type { Crop } from './usePlayback';
import { SOURCE_ASPECT } from './usePlayback';


export interface Figure {
  body: {
    /** 벡터 폴백용 몸통. 엉덩이 좌표가 없으면 null — 스프라이트 경로는 어깨만 쓴다. */
    torso: string | null;
    torsoRound: number;
    neck: string | null;
    /** 몸통 스프라이트를 꽂는 가로 뼈. 인물 기준 좌우다(화면 기준이 아니다). */
    shoulderRight: Point;
    shoulderLeft: Point;
    arms: {
      upper: string;
      fore: string;
      shoulder: Point;
      elbow: Point;
      wrist: Point;
      shoulderR: number;
      elbowR: number;
    }[];
  } | null;
  /** 모든 부위에 같은 굵기로 두르는 외곽선. */
  outline: number;
  /** 어깨 너비(px). 부위 치수의 기준자다. */
  unit: number;
  head: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    angleDeg: number;
    hair: string;
    /**
     * 머리 스프라이트를 꽂는 가로 뼈 — **안정화된** 눈초리 두 점이다(인물 기준 좌우).
     *
     * 실측 눈 좌표를 그대로 쓰면 안 된다. 프레임마다 다시 재는 크기·각도가 대부분
     * 측정 잡음이라 머리가 떤다 — `headAxis` 가 문장 전체 기준값과 데드밴드로 누른
     * 값을 여기 되돌려 놓는다.
     */
    eyeRight: Point;
    eyeLeft: Point;
    /**
     * 몸통의 목 지점(양어깨 중점). 머리를 옷깃 구멍에 좌우로 맞추는 표적이다 —
     * 자세한 이유는 `FACE_PART.neckCenter` 주석에 있다. 어깨가 없으면 null.
     */
    neckTarget: Point | null;
  } | null;
  face: {
    /**
     * 인물 기준 오른쪽 눈이 먼저다. `state` 는 **눈 조각을 고르는 값**이고, 나머지는
     * 벡터 폴백이 쓰는 치수다 — 둘은 같은 데이터에서 나오지만 표현이 다르다.
     */
    eyes: {
      side: 'right' | 'left';
      state: EyeState;
      center: Point;
      closed: boolean;
      dotR: number;
      half: number;
      stroke: number;
    }[];
    brows: string[];
    browWidth: number;
    /**
     * 눈썹을 평상시 높이에서 얼마나 올릴지 — **-1 … 1**. 양수가 올림이다.
     *
     * 눈썹 조각이 눈과 분리되어 있어 단계가 아니라 **연속**으로 옮긴다. 좌우를 하나로
     * 합치는 이유는 눈 상태와 같다(`eyeState` 주석).
     */
    browLift: number;
    mouth: string;
    mouthFilled: boolean;
    mouthStroke: number;
    /** 입 조각을 고르는 값. 벡터 폴백의 `mouthFilled` 와 같은 벌어짐에서 나온다. */
    mouthState: MouthState;
  } | null;
  hands: {
    shapes: { d: string; width: number }[];
    joints: { center: Point; r: number }[];
  }[];
}

export function buildFigure(at: At, baseline: HeadBaseline): Figure {
  const unit = span(at(POSE.leftShoulder), at(POSE.rightShoulder));

  return {
    outline: unit * OUTLINE_WIDTH,
    unit,
    body: unit > 0 ? buildBody(at, unit, baseline) : null,
    head: buildHead(at, baseline),
    face: buildFace(at, baseline),
    hands: [BLOCKS.leftHand[0], BLOCKS.rightHand[0]]
      .map((base) => buildHand(at, base))
      .filter((hand): hand is NonNullable<typeof hand> => hand !== null),
  };
}

function buildBody(at: At, unit: number, baseline: HeadBaseline): Figure['body'] {
  const ls = at(POSE.leftShoulder);
  const rs = at(POSE.rightShoulder);
  const lh = at(POSE.leftHip);
  const rh = at(POSE.rightHip);
  // 어깨가 없으면 몸통도 팔도 놓을 자리가 없다. 엉덩이는 벡터 몸통에만 필요하다 —
  // 스프라이트 경로는 어깨 두 점만 쓰므로 엉덩이 결측으로 몸을 통째로 지우지 않는다.
  if (![ls, rs].every(ok)) return null;
  const hipsOk = [lh, rh].every(ok);

  const arms = (
    [
      [POSE.leftShoulder, POSE.leftElbow, POSE.leftWrist],
      [POSE.rightShoulder, POSE.rightElbow, POSE.rightWrist],
    ] as const
  )
    .map(([s, e, w]) => {
      const shoulder = at(s);
      const elbow = at(e);
      const wrist = at(w);
      if (![shoulder, elbow, wrist].every(ok)) return null;
      return {
        upper: taper(shoulder, elbow, unit * LIMB.upperArmTop, unit * LIMB.upperArmBottom),
        fore: taper(elbow, wrist, unit * LIMB.forearmTop, unit * LIMB.forearmBottom),
        shoulder,
        elbow,
        wrist,
        shoulderR: unit * LIMB.upperArmTop,
        elbowR: unit * LIMB.forearmTop,
      };
    })
    .filter((arm): arm is NonNullable<typeof arm> => arm !== null);

  const neckPoint = at(POSE.neck);
  const axis = headAxis(at, baseline);
  const neck =
    ok(neckPoint) && axis
      ? taper(neckPoint, axis.eyeMid, unit * LIMB.neck, unit * LIMB.neck)
      : null;

  return {
    torso: hipsOk ? `M${pt(ls)}L${pt(rs)}L${pt(rh)}L${pt(lh)}Z` : null,
    torsoRound: unit * LIMB.torsoRound,
    neck,
    shoulderRight: rs,
    shoulderLeft: ls,
    arms,
  };
}

/**
 * 문장 전체에서 한 번만 정하는 머리 기준값 — 크기와 기울기.
 *
 * 사람이 재생 도중 갑자기 커지거나 작아질 리 없다. 매 프레임 재면 잡음만 따라온다.
 */
export interface HeadBaseline {
  /** 두 **눈 중심** 사이 거리. 머리 스프라이트의 배율 기준이다. */
  eyeSpan: number;
  angleDeg: number;
  /**
   * 평상시 눈 열림 (눈꺼풀 간격 / 눈 가로폭).
   *
   * 실측 분포가 매우 좁다(5~95백분위 0.229~0.313, 중앙값 0.278). 그 폭은 대부분
   * 측정 잡음이라 절대값으로 문턱을 박으면 눈이 매 프레임 커졌다 작아진다.
   * 문장 전체의 중앙값을 기준으로 두고 **거기서 얼마나 벗어났는지**로 판단한다 —
   * 머리 기울기·눈썹에 이미 쓰고 있는 방식과 같다.
   */
  eyeOpen: number;
}

/**
 * 머리의 축 — 위치는 프레임마다, **크기와 각도는 문장 전체의 기준값**에서 온다.
 *
 * 크기·각도를 매 프레임 얼굴 랜드마크에서 다시 재면 머리가 떤다(실측 방향 전환율
 * 40%·37% — 대부분 측정 잡음). 위치는 실제 움직임이라(8~15%) 그대로 따라간다.
 */
function headAxis(at: At, baseline: HeadBaseline) {
  const left = eyeCenter(at, FACE_POINTS.leftEyeOuter, FACE_POINTS.leftEyeInner);
  const right = eyeCenter(at, FACE_POINTS.rightEyeOuter, FACE_POINTS.rightEyeInner);
  if (!left || !right) return null;

  const rawAngle = (Math.atan2(left[1] - right[1], left[0] - right[0]) * 180) / Math.PI;
  const deviation = rawAngle - baseline.angleDeg;
  const beyond = Math.abs(deviation) - HEAD.angleDeadbandDeg;
  const angleDeg =
    beyond > 0
      ? baseline.angleDeg + Math.sign(deviation) * beyond * HEAD.angleGain
      : baseline.angleDeg;

  // 얼굴의 '아래' 는 눈 축에 수직이다. 눈–입 벡터로 재면 입술 잡음까지 따라 들어온다.
  const radians = (angleDeg * Math.PI) / 180;
  const eyeMid: Point = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
  // 눈초리를 기준값(크기·각도)으로 다시 놓는다 — 자리만 실측을 따르고 나머지는 눌린다.
  const half = baseline.eyeSpan / 2;
  const along: Point = [Math.cos(radians) * half, Math.sin(radians) * half];
  return {
    eyeMid,
    eyeSpan: baseline.eyeSpan,
    down: [-Math.sin(radians), Math.cos(radians)] as Point,
    angleDeg,
    eyeLeft: [eyeMid[0] + along[0], eyeMid[1] + along[1]] as Point,
    eyeRight: [eyeMid[0] - along[0], eyeMid[1] - along[1]] as Point,
  };
}

/**
 * 눈 하나의 중심 — 눈초리와 눈머리의 중점.
 *
 * 머리를 꽂는 기준을 **눈초리가 아니라 눈 중심**으로 잡는다. 머리 스프라이트에는
 * 이목구비가 그려져 있지 않아서 눈초리를 잴 데가 없고, 시안이 준 관절 가이드가
 * 표시한 것도 눈 중심 두 점이다. 중심은 끝점보다 잡음에도 강하다.
 */
function eyeCenter(at: At, outer: number, inner: number): Point | null {
  const a = at(outer);
  const b = at(inner);
  if (!ok(a) || !ok(b)) return null;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** 머리 중심 — 눈 축보다 조금 아래. 머리 도형과 이목구비 투영이 같은 값을 써야 한다. */
function headCenter(axis: NonNullable<ReturnType<typeof headAxis>>): Point {
  const ry = axis.eyeSpan * HEAD.halfWidth * HEAD.heightRatio;
  return [
    axis.eyeMid[0] + axis.down[0] * ry * HEAD.centerDrop,
    axis.eyeMid[1] + axis.down[1] * ry * HEAD.centerDrop,
  ];
}


function buildHead(at: At, baseline: HeadBaseline): Figure['head'] {
  const axis = headAxis(at, baseline);
  if (!axis) return null;

  const rx = axis.eyeSpan * HEAD.halfWidth;
  const ry = rx * HEAD.heightRatio;
  const [cx, cy] = headCenter(axis);

  // 머리카락 — 정수리를 덮는 띠. 가운데가 살짝 내려와 앞머리가 된다.
  // 회전은 바깥 <G> 가 맡으므로 여기선 축 정렬 좌표로 그린다.
  const hair =
    `M${cx - rx} ${cy - ry * 0.1}` +
    `A${rx} ${ry} 0 0 1 ${cx + rx} ${cy - ry * 0.1}` +
    `Q${cx + rx * 0.7} ${cy - ry * 0.55} ${cx} ${cy - ry * 0.52}` +
    `Q${cx - rx * 0.7} ${cy - ry * 0.55} ${cx - rx} ${cy - ry * 0.1}Z`;

  const neck = at(POSE.neck);
  const shoulders = [at(POSE.leftShoulder), at(POSE.rightShoulder)];

  return {
    cx,
    cy,
    rx,
    ry,
    angleDeg: axis.angleDeg,
    hair,
    eyeRight: axis.eyeRight,
    eyeLeft: axis.eyeLeft,
    // 합성점인 `POSE.neck` 이 없으면 양어깨 중점으로 대신한다 — 같은 뜻이다.
    neckTarget: ok(neck)
      ? neck
      : shoulders.every(ok)
        ? [(shoulders[0][0] + shoulders[1][0]) / 2, (shoulders[0][1] + shoulders[1][1]) / 2]
        : null,
  };
}

function buildFace(at: At, baseline: HeadBaseline): Figure['face'] {
  const axis = headAxis(at, baseline);
  if (!axis) return null;

  const [cx, cy] = headCenter(axis);
  const rx = axis.eyeSpan * HEAD.halfWidth;
  const ry = rx * HEAD.heightRatio;

  const eyes: NonNullable<Figure['face']>['eyes'] = [];
  const brows: string[] = [];
  /** 눈썹 올림값·눈 열림 — 두 눈을 모아 **하나의** 표정으로 만든다(아래 `eyeState` 주석). */
  const shifts: number[] = [];
  const opens: number[] = [];
  let anyClosed = false;

  for (const side of [
    {
      name: 'right' as const,
      dir: -1,
      outer: FACE_POINTS.rightEyeOuter,
      inner: FACE_POINTS.rightEyeInner,
      upper: FACE_POINTS.rightEyeUpper,
      lower: FACE_POINTS.rightEyeLower,
      brow: RIGHT_BROW,
    },
    {
      name: 'left' as const,
      dir: 1,
      outer: FACE_POINTS.leftEyeOuter,
      inner: FACE_POINTS.leftEyeInner,
      upper: FACE_POINTS.leftEyeUpper,
      lower: FACE_POINTS.leftEyeLower,
      brow: LEFT_BROW,
    },
  ]) {
    const outer = at(side.outer);
    const inner = at(side.inner);
    const upper = at(side.upper);
    const lower = at(side.lower);
    if (![outer, inner, upper, lower].every(ok)) continue;

    // 자리·크기는 머리 기준 고정. 실측 좌표를 그대로 쓰면 미세한 비대칭과 프레임
    // 잡음이 전부 "찌푸린 인상" 과 "꿈틀거림" 으로 읽힌다 — 화면에서 눈이 몇 픽셀이라 그렇다.
    // 데이터가 정하는 건 **떴나 감았나** 하나뿐이다.
    const eyeX = cx + side.dir * rx * EYE.offsetX;
    const eyeY = cy + ry * EYE.offsetY;
    const eyeWidth = span(outer, inner) || 1;

    // 눈썹 값을 먼저 구한다 — 눈 조각은 눈썹과 눈이 한 세트라 상태를 함께 정해야 한다.
    const browPoints = side.brow.map(at);
    const shift = browPoints.every(ok) ? browShift(span(browPoints[0], upper) / eyeWidth) : 0;
    const open = span(upper, lower) / eyeWidth;
    const closed = open < EYE.closedBelow;
    shifts.push(shift);
    opens.push(open);
    if (closed) anyClosed = true;

    eyes.push({
      side: side.name,
      // 상태는 두 눈을 다 본 뒤 한 번에 정한다 — 아래에서 채운다.
      state: 'normal',
      center: [eyeX, eyeY],
      closed,
      dotR: rx * EYE.dotR,
      half: rx * EYE.closedHalf,
      stroke: rx * EYE.closedStroke,
    });

    // 눈썹 — 얇은 호. 높이만 데이터에서 오되 **잡음 폭은 통째로 무시한다**.
    if (!browPoints.every(ok)) continue;
    const lift = rx * (EYE.browLift + shift);
    const half = rx * EYE.browWidth * 0.5;
    const browY = eyeY - lift;
    brows.push(
      `M${pt([eyeX - half, browY])}` +
        `Q${pt([eyeX, browY - rx * EYE.browArc])} ${pt([eyeX + half, browY])}`,
    );
  }

  // 입 — 다물면 부드러운 곡선 하나, 벌리면 채운 타원. 벌어짐은 데이터가 정한다.
  const mouthL = at(FACE_POINTS.mouthCornerLeft);
  const mouthR = at(FACE_POINTS.mouthCornerRight);
  const innerUpper = at(LIPS_INNER_RING[15]);
  const innerLower = at(LIPS_INNER_RING[5]);

  const mouthY = cy + ry * MOUTH.offsetY;
  const half = rx * MOUTH.width * 0.5;
  const gap =
    [mouthL, mouthR, innerUpper, innerLower].every(ok) && span(mouthL, mouthR) > 0
      ? span(innerUpper, innerLower) / span(mouthL, mouthR)
      : 0;
  const filled = gap > MOUTH.openMin;
  const openHeight = rx * MOUTH.openScale * Math.min(1, gap / MOUTH.openFull);

  const mouth = filled
    ? `M${pt([cx - half, mouthY])}` +
      `Q${pt([cx, mouthY - openHeight])} ${pt([cx + half, mouthY])}` +
      `Q${pt([cx, mouthY + openHeight])} ${pt([cx - half, mouthY])}Z`
    : `M${pt([cx - half, mouthY])}` +
      `Q${pt([cx, mouthY + rx * MOUTH.restCurve])} ${pt([cx + half, mouthY])}`;

  // 두 눈에 **같은 조각**을 쓴다. 좌우를 따로 정하면 한쪽 눈썹만 올라간 얼굴이 나온다 —
  // 눈썹-눈 간격은 랜드마크 두 점으로 재는 값이라 좌우 차이가 대부분 측정 잡음인데,
  // 조각이 세 단계뿐이라 그 작은 차이가 표정을 통째로 갈라 놓는다. 벡터 눈썹은 높이가
  // 연속값이라 같은 잡음이 눈에 띄지 않았다.
  const mean = (values: number[], fallback: number) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback;
  // 좌표의 얼굴 신호가 잡음과 구분되지 않아 기본은 고정 표정이다 — 근거는 `FACE_ANIMATED`.
  const state = FACE_ANIMATED
    ? eyeState(anyClosed, mean(opens, baseline.eyeOpen), baseline.eyeOpen)
    : 'normal';
  for (const eye of eyes) eye.state = state;
  const browLift = FACE_ANIMATED
    ? Math.max(-1, Math.min(1, mean(shifts, 0) / EYE.browMaxShift))
    : 0;

  return {
    eyes,
    brows,
    browLift,
    browWidth: rx * EYE.browStroke,
    mouth,
    mouthFilled: filled,
    mouthStroke: rx * MOUTH.stroke,
    mouthState: FACE_ANIMATED ? mouthStateOf(gap) : 'closed',
  };
}

/**
 * 눈 조각 고르기 — 깜빡임은 절대값, 나머지는 **문장 기준값에서의 편차**로.
 *
 * 실측 눈 열림 분포가 5~95백분위 0.229~0.313 으로 매우 좁다. 그 폭에 절대 문턱을
 * 걸면 조각이 매 프레임 바뀌어 눈이 파르르 떤다 — 대부분이 측정 잡음이기 때문이다.
 * 그래서 기준값 둘레의 데드밴드 안은 전부 `normal` 로 두고, 벗어난 만큼만 단계를 옮긴다.
 * 깜빡임(`closedBelow`)만 절대값인데, 그건 평상시 띠에서 한참 아래라 잡음과 섞이지 않는다.
 */
function eyeState(closed: boolean, open: number, rest: number): EyeState {
  if (closed) return 'closed';
  const beyond = Math.abs(open - rest) - EYE.openDeadband;
  if (beyond <= 0) return 'normal';
  const steps = Math.min(2, 1 + Math.floor(beyond / EYE.openStep));
  if (open > rest) return steps >= 2 ? 'wide' : 'open';
  return 'half';
}

function mouthStateOf(gap: number): MouthState {
  if (gap > MOUTH.wideAbove) return 'wide';
  if (gap > MOUTH.openMin) return 'open';
  return gap > MOUTH.partedAbove ? 'parted' : 'closed';
}

/**
 * 눈썹–눈 간격 → 눈썹을 위아래로 얼마나 옮길지 (머리 반폭 대비).
 *
 * 기준값 둘레의 좁은 띠는 **측정 잡음이라 0 으로 눌러 버린다.** 그 밖으로 벗어날
 * 때만 움직이므로 평상시에는 눈썹이 고정돼 있고, 진짜 눈썹 올림은 살아 있다.
 */
function browShift(raw: number): number {
  const deviation = raw - EYE.browRest;
  const beyond = Math.abs(deviation) - EYE.browDeadband;
  if (beyond <= 0) return 0;
  const shift = Math.min(beyond * EYE.browGain, EYE.browMaxShift);
  // 간격이 넓어지면(눈썹이 올라가면) 더 띄운다.
  return deviation > 0 ? shift : -shift;
}

function buildHand(at: At, base: number): Figure['hands'][number] | null {
  const wrist = at(base);
  const middleMcp = at(base + 9);
  if (!ok(wrist) || !ok(middleMcp)) return null;
  // 손 크기 기준. 손이 비스듬하면 손목~중지 거리가 짧아져 손 전체가 쪼그라들므로
  // 손바닥 가로폭(검지~새끼 MCP)과 견줘 큰 쪽을 쓴다.
  const across = span(at(base + 5), at(base + 17));
  const unit = Math.max(span(wrist, middleMcp), Number.isFinite(across) ? across * 1.15 : 0);
  if (unit <= 0) return null;

  const shapes: { d: string; width: number }[] = [];
  const joints: { center: Point; r: number }[] = [];

  // 손바닥 — 손목 · 엄지 뿌리 · 네 MCP 를 두른 면.
  // 볼록 껍질을 쓰는 이유: 손이 돌아가면 엄지 뿌리가 반대쪽으로 넘어가 다각형이
  // **스스로 꼬인다.** 꼬인 면은 윤곽선을 두르는 순간 삐죽한 조각으로 드러난다.
  const palmPoints = PALM_RING.map((i) => at(base + i));
  if (!palmPoints.every(ok)) return null;
  const palm = smoothRing(convexHull(palmPoints));
  if (!palm) return null;
  shapes.push({ d: palm, width: unit * HAND.palmWidth });

  // 손가락 — 마디마다 굵기가 줄어드는 사다리꼴. 굵기가 일정하면 손이 아니라 막대다.
  let drawn = 0;
  for (let index = 0; index < FINGER_CHAINS.length; index += 1) {
    const points = FINGER_CHAINS[index].map((i) => at(base + i));
    if (!points.every(ok)) continue; // 미검출 마디가 있으면 그 손가락만 건너뛴다
    const isThumb = index === 0;
    const from = unit * (isThumb ? HAND.thumbBase : HAND.fingerBase);
    const to = unit * (isThumb ? HAND.thumbTip : HAND.fingerTip);

    for (let step = 0; step + 1 < points.length; step += 1) {
      const t0 = step / (points.length - 1);
      const t1 = (step + 1) / (points.length - 1);
      const half0 = from + (to - from) * t0;
      const half1 = from + (to - from) * t1;
      shapes.push({ d: taper(points[step], points[step + 1], half0, half1), width: 0 });
      joints.push({ center: points[step], r: half0 });
    }
    joints.push({ center: points[points.length - 1], r: to }); // 손끝은 둥글게
    drawn += 1;
  }
  if (drawn === 0) return null;

  return { shapes, joints };
}

/**
 * 문장 전체 프레임에서 머리 크기·기울기의 **중앙값**을 낸다.
 *
 * 평균이 아니라 중앙값인 이유: 얼굴 검출이 한두 프레임 튀는 일이 있고, 평균은 그
 * 한 프레임에 끌려간다. 중앙값은 끌려가지 않는다.
 */
export function headBaselineOf(sequences: readonly SignSequence[]): HeadBaseline {
  const spans: number[] = [];
  const angles: number[] = [];
  const opens: number[] = [];

  for (const sequence of sequences) {
    const { xy, keypointCount, frameCount } = sequence;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const base = frame * keypointCount * 2;
      // 시퀀스는 16:9 정규화 좌표라 x 를 펴야 길이·각도가 실제와 같아진다.
      const at = (kp: number): Point | null => {
        const x = xy[base + kp * 2];
        const y = xy[base + kp * 2 + 1];
        return Number.isFinite(x) && Number.isFinite(y) ? [x * SOURCE_ASPECT, y] : null;
      };
      const mid = (a: Point | null, b: Point | null): Point | null =>
        a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;

      const leftOuter = at(FACE_POINTS.leftEyeOuter);
      const leftInner = at(FACE_POINTS.leftEyeInner);
      const rightOuter = at(FACE_POINTS.rightEyeOuter);
      const rightInner = at(FACE_POINTS.rightEyeInner);
      const left = mid(leftOuter, leftInner);
      const right = mid(rightOuter, rightInner);

      if (left && right) {
        const length = span(left, right);
        if (length > 0) {
          spans.push(length);
          angles.push((Math.atan2(left[1] - right[1], left[0] - right[0]) * 180) / Math.PI);
        }
      }

      for (const [outer, inner, upper, lower] of [
        [leftOuter, leftInner, at(FACE_POINTS.leftEyeUpper), at(FACE_POINTS.leftEyeLower)],
        [rightOuter, rightInner, at(FACE_POINTS.rightEyeUpper), at(FACE_POINTS.rightEyeLower)],
      ] as const) {
        if (!outer || !inner || !upper || !lower) continue;
        const width = span(outer, inner);
        if (width > 0) opens.push(span(upper, lower) / width);
      }
    }
  }

  return {
    eyeSpan: median(spans) || 0.05,
    angleDeg: median(angles),
    eyeOpen: median(opens) || EYE.openRest,
  };
}

/**
 * 시퀀스 전체가 차지하는 좌표 범위 + 여백.
 *
 * 미검출(NaN)은 건너뛴다. 좌표가 하나도 없으면 원본 화각 전체로 물러난다 — 시퀀스가
 * 깨졌을 때 0 으로 나눠 화면이 사라지는 것보다 낫다.
 */
export function sequenceCrop(sequences: readonly SignSequence[]): Crop {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const sequence of sequences) {
    const { xy } = sequence;
    for (let i = 0; i < xy.length; i += 2) {
      const x = xy[i];
      const y = xy[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return { x0: 0, y0: 0, x1: 1, y1: 1 };
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return {
    x0: Math.max(0, minX - spanX * CROP_MARGIN.x),
    x1: Math.min(1, maxX + spanX * CROP_MARGIN.x),
    y0: Math.max(0, minY - spanY * CROP_MARGIN.top),
    y1: Math.min(1, maxY + spanY * CROP_MARGIN.bottom),
  };
}
