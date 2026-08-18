/**
 * 임시 3D풍 아바타 재생기.
 *
 * 빌트인 좌표 자산(`sequenceAssets`)을 사람 형상으로 그린다. 재생 타임라인과 단어 사이
 * 전환 보간은 `usePlayback` 이 맡고, 이 파일은 "무엇을 그리는가"만 맡는다.
 *
 * ## 이것은 3D 가 아니다
 *
 * 자산이 **xy 2D**(`index.json` 의 `channel_count: 2`)라 실제 3D 리깅이 아니라
 * 명암·굵기로 입체감을 흉내 낸 2.5D 다. 그래서 **손바닥이 어느 쪽을 보는지 표현할 수
 * 없다** — 2D 점만으로는 전완 롤이 유일하게 정해지지 않는다. 수어에서 손바닥 방향은
 * 의미를 바꾸므로, 이 아바타는 "그럴듯해 보이지만 손바닥 방향은 틀릴 수 있는" 상태다.
 * 실사 아바타로 갈 거라면 좌표를 xyz 로 다시 뽑는 것이 선행 조건이다.
 *
 * ## 얼굴 — 도형은 고정, 값은 데이터
 *
 * 처음에는 실측 랜드마크를 그대로 이어 눈·입 윤곽을 그렸다. **결과가 계속 못생겼다** —
 * 화면에서 눈이 몇 픽셀짜리라 랜드마크의 미세한 비대칭이 전부 "찌푸린 인상" 으로
 * 읽혔고, 배율을 키워도 나아지지 않았다.
 *
 * 그래서 **도형은 단순하게 고정하고 데이터는 그 도형의 크기·각도만 정한다.** 눈은
 * 타원이고 그 높이가 개폐를, 눈썹은 호이고 그 높이·기울기가 표정을, 입은 곡선/타원이고
 * 그 벌어짐이 입모양을 나른다. 깜빡임·눈썹 올림·입 벌림은 그대로 살아 있다.
 *
 * 머리 윤곽·머리카락·귀는 데이터에 없어서 지어낸 것이다 — 눈 간격으로 크기를,
 * 눈 축으로 각도를 추정한다.
 *
 * ## 크기는 전부 상대값이다
 *
 * 팔 굵기·머리 크기를 픽셀 상수로 두면 화면 크기나 인물 거리가 바뀔 때 비율이 깨진다.
 * 어깨 너비(`unit`)와 눈 간격(`eyeSpan`)을 기준으로만 계산한다.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { BLOCKS, FINGER_CHAINS, PALM_RING, POSE } from './bodyLayout';
import { FACE_POINTS, LEFT_BROW, LIPS_INNER_RING, RIGHT_BROW } from './faceLayout';
import type { SignSequence } from './sequenceAssets';
import type { Crop } from './usePlayback';
import { SOURCE_ASPECT, useSequencePlayback } from './usePlayback';

export interface AvatarPlayerProps {
  /** 이어 재생할 시퀀스. 순서가 곧 문장 어순이다. */
  sequences: readonly SignSequence[];
  fps: number;
  playing: boolean;
  /**
   * 값이 바뀌면 처음부터 다시 재생한다.
   *
   * `playing` 을 껐다 켜는 방식으로는 안 된다 — 같은 핸들러 안의 setState 두 번은
   * 배치되어 최종값 하나로 합쳐지므로, **재생 중에 누르면 상태가 안 바뀌어 아무 일도
   * 일어나지 않는다.** "다시" 는 값이 아니라 신호라서 토큰으로 표현한다.
   */
  restartToken?: number;
  /** 단어 사이 전환 프레임 수. 0 이면 전환 없이 바로 붙는다. */
  transitionFrames?: number;
  /** 마지막 프레임까지 그린 뒤 한 번 호출된다. */
  onFinished?: () => void;
  /** 지금 몇 번째 단어를 그리고 있는지. 전환 중에는 들어가는 쪽 단어를 알린다. */
  onWordChange?: (index: number) => void;
  testID?: string;
}

/**
 * 임시 팔레트. 테마 토큰에는 피부색이 없다(UI 색이 아니라 그림 색이다).
 * 실제 아바타 자산이 정해지면 통째로 교체될 값이라 여기 가둬 둔다.
 */
const PAINT = {
  skinLight: '#fbdcc4',
  skinMid: '#f2c1a1',
  skinDark: '#dda480',
  shadow: '#d59d7c',
  shirtLight: '#7b8ce0',
  shirtMid: '#4f46e5',
  shirtDark: '#3b32b4',
  hair: '#3a2418',
  outline: '#a4694c',
  iris: '#4a3325',
  brow: '#4a3526',
  lip: '#d08a80',
  mouthInner: '#8a4c48',
} as const;

/** 어깨 너비 대비 굵기. 전부 프로토타입 임시값이고 눈으로 맞춘 것이다. */
const LIMB = {
  torsoRound: 0.14,
  upperArmTop: 0.125,
  upperArmBottom: 0.095,
  forearmTop: 0.095,
  forearmBottom: 0.07,
  neck: 0.135,
} as const;

/**
 * 눈 바깥 꼬리 간격(eyeSpan) 대비 머리 크기.
 *
 * 데이터에 머리 윤곽이 없어 되짚어 그린다. 실측 인체 비례(머리 폭 ≈ 바깥 눈꼬리
 * 간격의 1.7배)로 맞춰 봤더니 **화면에서 얼굴이 작고 길어 인상이 굳어 보였다** —
 * 이목구비는 실측 위치라 얼굴만 커지면 상대적으로 오밀조밀해지기 때문이다.
 * 그래서 인체 비례보다 **머리를 크고 둥글게** 잡았다. 캐리커처가 사람보다 사람처럼
 * 읽히는 것과 같은 이유다.
 *
 * ⚠️ 자산의 눈·입 위치는 실측이고 **머리만 추정**이라, 이 값이 어긋나면 그 차이가
 * 그대로 드러난다.
 */
const HEAD = {
  halfWidth: 1.15,
  heightRatio: 1.3,
  centerDrop: 0.12,
  /**
   * 머리 기울기에서 무시할 폭(도)과 그 밖의 반영 비율.
   *
   * 눈 축 각도를 매 프레임 다시 재면 머리가 떤다 — 실측 방향 전환율이 37% 로
   * 대부분 측정 잡음이다(50% 가 백색 잡음의 지문). 문장 전체의 중앙값을 기준으로
   * 잡고 이 폭 안쪽은 눌러, **진짜 고개 기울임만** 남긴다.
   */
  angleDeadbandDeg: 3,
  angleGain: 0.6,
} as const;

/**
 * 이목구비를 그리는 방식 — **단순한 도형으로 그리고 데이터는 그 도형의 크기·각도만
 * 정한다.**
 *
 * 처음에는 실측 랜드마크를 그대로 이어 눈·입 윤곽을 그렸는데, 화면에서 눈이 몇 픽셀
 * 짜리라 어떤 배율로 키워도 "반쯤 감고 찌푸린 얼굴" 이 나왔다. 랜드마크의 미세한
 * 비대칭이 작은 얼굴에서는 전부 인상으로 읽히기 때문이다.
 *
 * 그래서 **표현은 도형이, 값은 데이터가** 맡는다 — 눈은 타원이고 그 높이가 개폐를,
 * 눈썹은 호이고 그 높이·기울기가 표정을, 입은 곡선/타원이고 그 벌어짐이 입모양을
 * 나른다. 깜빡임·눈썹 올림·입 벌림은 그대로 살아 있고 인상만 정돈된다.
 */
const EYE = {
  /** 자리 — 머리 반폭/반높이 대비. */
  offsetX: 0.38,
  offsetY: 0.08,
  /** 뜬 눈은 **점** 하나. 크기는 고정이라 잡음이 낄 자리가 없다. */
  dotR: 0.055,
  /** 감은 눈은 **일자**. 점보다 조금 넓고 얇다. */
  closedHalf: 0.085,
  closedStroke: 0.045,
  /**
   * 이 아래로 내려가면 감은 것으로 본다 (눈꺼풀 간격 / 눈 가로폭).
   *
   * 실측 평상시 값이 0.25~0.37 이고 프레임간 잡음이 ±0.007 이라, 0.16 은 그 띠에서
   * 한참 아래다 — **평상시에는 절대 발동하지 않고** 진짜로 감을 때만 걸린다.
   * 덕분에 시간 평활 없이도 깜빡임이 떨리지 않는다.
   */
  closedBelow: 0.16,
  /** 눈썹 — 얇은 호. */
  browLift: 0.144,
  browWidth: 0.23,
  browArc: 0.075,
  browStroke: 0.052,
  /**
   * 눈썹 높이의 기준값과 무시할 폭 (눈썹–눈 간격 / 눈 가로폭).
   *
   * 실측 평상시 0.81~0.97 이 **거의 전부 측정 잡음**이다(프레임간 방향 전환율 52%,
   * 백색 잡음의 지문이 50%). 그 폭을 통째로 무시해야 눈썹이 꿈틀대지 않는다.
   * 진짜 눈썹 올림은 이 띠를 벗어나므로 그때만 움직인다.
   */
  browRest: 0.89,
  browDeadband: 0.1,
  browGain: 0.25,
  browMaxShift: 0.12,
} as const;

const MOUTH = {
  /** 입 높이는 머리 반높이 대비, 나머지는 머리 반폭 대비. */
  offsetY: 0.52,
  width: 0.287,
  restCurve: 0.098,
  stroke: 0.057,
  /** 이 이상 벌어지면 채운 입으로 그린다 (입꼬리 간격 대비). */
  openMin: 0.2,
  openFull: 0.55,
  openScale: 0.16,
} as const;

/**
 * 손 치수 — 손목~중지 MCP 거리(`unit`) 대비.
 *
 * 손이 얼굴 위로 올라오는 동작이 흔한데 둘 다 살색이라 **경계가 사라진다.** 그래서
 * 윤곽선을 두르고, 선이 생기는 만큼 실루엣도 손처럼 다듬는다 — 굵기가 일정한 막대
 * 다섯 개에 선만 두르면 장갑처럼 보인다.
 */
const HAND = {
  /** 손바닥 — MCP 를 이은 다각형은 손금 선에 가까워서 살을 붙여야 손바닥이 된다. */
  palmWidth: 0.52,
  /** 손가락은 뿌리에서 끝으로 가늘어진다. 엄지는 굵고 짧다. */
  fingerBase: 0.17,
  fingerTip: 0.115,
  thumbBase: 0.2,
  thumbTip: 0.13,
} as const;

/**
 * 외곽선 두께 — 어깨 너비 대비.
 *
 * 손이 얼굴 위로 올라오면 둘 다 살색이라 경계가 사라진다. 손에만 선을 두르면 그
 * 손만 다른 그림에서 온 것처럼 보이므로 **모든 부위에 같은 굵기로** 두른다.
 *
 * 그리는 법: 부위마다 같은 도형을 굵게 한 번 깔고 그 위에 제 색을 얹는다. 겹친
 * 도형들의 바깥선만 남고 내부 경계는 덮이므로 도형 합집합을 구할 필요가 없다.
 */
const OUTLINE_WIDTH = 0.016;

/**
 * 인물 둘레에 남길 여백 (잘라낸 범위 대비 비율).
 *
 * 0 이면 손끝·정수리가 화면 가장자리에 딱 붙어 잘린 것처럼 보인다. 위쪽을 더 주는 것은
 * 머리 윤곽·머리카락이 **데이터에 없는 추정 형상**이라 좌표 bbox 보다 위로 튀어나오기
 * 때문이다 — 여기를 줄이면 정수리가 잘린다.
 */
const CROP_MARGIN = { x: 0.14, top: 0.16, bottom: 0.05 } as const;

type Point = readonly [number, number];
type At = (keypoint: number) => Point;

export function AvatarPlayer({
  sequences,
  fps,
  playing,
  restartToken,
  transitionFrames,
  onFinished,
  onWordChange,
  testID,
}: AvatarPlayerProps) {
  // 원본 화각은 인물이 가로의 30% 남짓이라, 그대로 담으면 양옆이 비고 사람만 작아진다.
  // 문장에 쓰인 시퀀스 **전체**의 범위로 한 번만 정한다 — 프레임마다 다시 계산하면
  // 재생 중에 화면이 계속 줌인·줌아웃한다.
  const crop = useMemo(() => sequenceCrop(sequences), [sequences]);
  // 머리 크기·기울기는 문장 전체에서 한 번만 정한다 — 프레임마다 재면 머리가 떤다.
  const rawBaseline = useMemo(() => headBaselineOf(sequences), [sequences]);

  const { box, stage, at, onLayout } = useSequencePlayback({
    sequences,
    fps,
    playing,
    restartToken,
    transitionFrames,
    onFinished,
    onWordChange,
    crop,
  });

  // 기준값은 정규화 단위로 재고, 그리기는 화면 픽셀로 한다 — 여기서 한 번 환산한다.
  // 세로 배율을 쓰는 이유: `at()` 이 실제 종횡비를 지키므로 물리 길이는 세로 배율과 같다.
  const baseline = useMemo(() => {
    if (!stage) return null;
    const pxPerUnit = stage.height / (crop.y1 - crop.y0);
    return { eyeSpan: rawBaseline.eyeSpan * pxPerUnit, angleDeg: rawBaseline.angleDeg };
  }, [rawBaseline, stage, crop.y0, crop.y1]);

  const figure = useMemo(
    () => (at && baseline ? buildFigure(at, baseline) : null),
    [at, baseline],
  );

  return (
    <View style={styles.root} testID={testID} onLayout={onLayout}>
      {stage ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            {/* userSpaceOnUse — 도형마다 그라디언트가 다시 시작하면 이음매가 보인다. */}
            <LinearGradient
              id="avatar-skin"
              gradientUnits="userSpaceOnUse"
              x1={stage.x}
              y1={stage.y}
              x2={stage.x + stage.width}
              y2={stage.y + stage.height}
            >
              <Stop offset="0" stopColor={PAINT.skinLight} />
              <Stop offset="0.55" stopColor={PAINT.skinMid} />
              <Stop offset="1" stopColor={PAINT.skinDark} />
            </LinearGradient>
            <LinearGradient
              id="avatar-shirt"
              gradientUnits="userSpaceOnUse"
              x1={stage.x}
              y1={stage.y}
              x2={stage.x + stage.width}
              y2={stage.y + stage.height}
            >
              <Stop offset="0" stopColor={PAINT.shirtLight} />
              <Stop offset="0.5" stopColor={PAINT.shirtMid} />
              <Stop offset="1" stopColor={PAINT.shirtDark} />
            </LinearGradient>
          </Defs>

          {figure ? (
            <>
              {figure.body ? (
                <G>
                  {/* 목 — 옷깃을 가로지르는 사각형으로 보이지 않게 몸통보다 먼저. */}
                  {figure.body.neck ? (
                    <>
                      <Path
                        d={figure.body.neck}
                        fill={PAINT.outline}
                        stroke={PAINT.outline}
                        strokeWidth={figure.outline * 2}
                        strokeLinejoin="round"
                      />
                      <Path d={figure.body.neck} fill="url(#avatar-skin)" />
                      {/* 턱 밑 그림자 — 없으면 목과 얼굴이 한 덩어리로 붙어 보인다. */}
                      <Path d={figure.body.neck} fill={PAINT.shadow} opacity={0.35} />
                    </>
                  ) : null}
                  <Path
                    d={figure.body.torso}
                    fill={PAINT.outline}
                    stroke={PAINT.outline}
                    strokeWidth={figure.body.torsoRound + figure.outline * 2}
                    strokeLinejoin="round"
                  />
                  <Path
                    d={figure.body.torso}
                    fill="url(#avatar-shirt)"
                    stroke="url(#avatar-shirt)"
                    strokeWidth={figure.body.torsoRound}
                    strokeLinejoin="round"
                  />
                  {figure.body.arms.map((arm, index) => (
                    <G key={index}>
                      {/* 소매와 팔뚝을 따로 두른다 — 옷깃 경계에 선이 생겨야 자연스럽다. */}
                      <Path
                        d={arm.upper}
                        fill={PAINT.outline}
                        stroke={PAINT.outline}
                        strokeWidth={figure.outline * 2}
                        strokeLinejoin="round"
                      />
                      <Circle
                        cx={arm.shoulder[0]}
                        cy={arm.shoulder[1]}
                        r={arm.shoulderR + figure.outline}
                        fill={PAINT.outline}
                      />
                      <Path d={arm.upper} fill="url(#avatar-shirt)" />
                      <Circle
                        cx={arm.shoulder[0]}
                        cy={arm.shoulder[1]}
                        r={arm.shoulderR}
                        fill="url(#avatar-shirt)"
                      />
                      <Path
                        d={arm.fore}
                        fill={PAINT.outline}
                        stroke={PAINT.outline}
                        strokeWidth={figure.outline * 2}
                        strokeLinejoin="round"
                      />
                      <Circle
                        cx={arm.elbow[0]}
                        cy={arm.elbow[1]}
                        r={arm.elbowR + figure.outline}
                        fill={PAINT.outline}
                      />
                      <Path d={arm.fore} fill="url(#avatar-skin)" />
                      <Circle
                        cx={arm.elbow[0]}
                        cy={arm.elbow[1]}
                        r={arm.elbowR}
                        fill="url(#avatar-skin)"
                      />
                    </G>
                  ))}
                </G>
              ) : null}

              {figure.head ? (
                <G
                  rotation={figure.head.angleDeg}
                  originX={figure.head.cx}
                  originY={figure.head.cy}
                >
                  {/* 머리 윤곽·머리카락은 데이터에 없는 추정 형상이다. */}
                  <Ellipse
                    cx={figure.head.cx}
                    cy={figure.head.cy}
                    rx={figure.head.rx + figure.outline}
                    ry={figure.head.ry + figure.outline}
                    fill={PAINT.outline}
                  />
                  <Ellipse
                    cx={figure.head.cx}
                    cy={figure.head.cy}
                    rx={figure.head.rx}
                    ry={figure.head.ry}
                    fill="url(#avatar-skin)"
                  />
                  <Path
                    d={figure.head.hair}
                    fill={PAINT.outline}
                    stroke={PAINT.outline}
                    strokeWidth={figure.outline * 2}
                    strokeLinejoin="round"
                  />
                  <Path d={figure.head.hair} fill={PAINT.hair} />
                </G>
              ) : null}

              {figure.face ? (
                <G>
                  {figure.face.eyes.map((eye, index) =>
                    eye.closed ? (
                      <Path
                        key={index}
                        d={`M${(eye.center[0] - eye.half).toFixed(1)} ${eye.center[1].toFixed(1)}L${(eye.center[0] + eye.half).toFixed(1)} ${eye.center[1].toFixed(1)}`}
                        stroke={PAINT.iris}
                        strokeWidth={eye.stroke}
                        strokeLinecap="round"
                      />
                    ) : (
                      <Circle
                        key={index}
                        cx={eye.center[0]}
                        cy={eye.center[1]}
                        r={eye.dotR}
                        fill={PAINT.iris}
                      />
                    ),
                  )}
                  {figure.face.brows.map((brow, index) => (
                    <Path
                      key={index}
                      d={brow}
                      stroke={PAINT.brow}
                      strokeWidth={figure.face!.browWidth}
                      strokeLinecap="round"
                      fill="none"
                    />
                  ))}
                  {figure.face.mouthFilled ? (
                    <Path d={figure.face.mouth} fill={PAINT.mouthInner} />
                  ) : (
                    <Path
                      d={figure.face.mouth}
                      stroke={PAINT.lip}
                      strokeWidth={figure.face.mouthStroke}
                      strokeLinecap="round"
                      fill="none"
                    />
                  )}
                </G>
              ) : null}

              {/* 손은 맨 앞이다 — 수어에서 손이 얼굴을 가리는 동작이 흔하다.
                  손 전체를 한 덩어리로 두르므로 손가락 사이에는 선이 생기지 않는다. */}
              {figure.hands.map((hand, index) => (
                <G key={index}>
                  {hand.shapes.map((shape, i) => (
                    <Path
                      key={`o${i}`}
                      d={shape.d}
                      fill={PAINT.outline}
                      stroke={PAINT.outline}
                      strokeWidth={shape.width + figure.outline * 2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {hand.joints.map((joint, i) => (
                    <Circle
                      key={`oj${i}`}
                      cx={joint.center[0]}
                      cy={joint.center[1]}
                      r={joint.r + figure.outline}
                      fill={PAINT.outline}
                    />
                  ))}
                  {hand.shapes.map((shape, i) => (
                    <Path
                      key={`f${i}`}
                      d={shape.d}
                      fill="url(#avatar-skin)"
                      stroke="url(#avatar-skin)"
                      strokeWidth={shape.width}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  {hand.joints.map((joint, i) => (
                    <Circle
                      key={`fj${i}`}
                      cx={joint.center[0]}
                      cy={joint.center[1]}
                      r={joint.r}
                      fill="url(#avatar-skin)"
                    />
                  ))}
                </G>
              ))}
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * 시퀀스 전체가 차지하는 좌표 범위 + 여백.
 *
 * 미검출(NaN)은 건너뛴다. 좌표가 하나도 없으면 원본 화각 전체로 물러난다 — 자산이
 * 깨졌을 때 0 으로 나눠 화면이 사라지는 것보다 낫다.
 */
/**
 * 문장 전체 프레임에서 머리 크기·기울기의 **중앙값**을 낸다.
 *
 * 평균이 아니라 중앙값인 이유: 얼굴 검출이 한두 프레임 튀는 일이 있고, 평균은 그
 * 한 프레임에 끌려간다. 중앙값은 끌려가지 않는다.
 */
function headBaselineOf(sequences: readonly SignSequence[]): HeadBaseline {
  const spans: number[] = [];
  const angles: number[] = [];

  for (const sequence of sequences) {
    const { xy, keypointCount, frameCount } = sequence;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const base = frame * keypointCount * 2;
      const lx = xy[base + FACE_POINTS.leftEyeOuter * 2];
      const ly = xy[base + FACE_POINTS.leftEyeOuter * 2 + 1];
      const rxv = xy[base + FACE_POINTS.rightEyeOuter * 2];
      const ryv = xy[base + FACE_POINTS.rightEyeOuter * 2 + 1];
      if (![lx, ly, rxv, ryv].every(Number.isFinite)) continue;
      // 자산은 16:9 정규화 좌표라 x 를 펴야 길이·각도가 실제와 같아진다.
      const dx = (lx - rxv) * SOURCE_ASPECT;
      const dy = ly - ryv;
      const length = Math.hypot(dx, dy);
      if (length <= 0) continue;
      spans.push(length);
      angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
    }
  }

  return { eyeSpan: median(spans) || 0.05, angleDeg: median(angles) };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sequenceCrop(sequences: readonly SignSequence[]): Crop {
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

// ---------------------------------------------------------------- 기하 계산

interface Figure {
  body: {
    torso: string;
    torsoRound: number;
    neck: string | null;
    arms: {
      upper: string;
      fore: string;
      shoulder: Point;
      elbow: Point;
      shoulderR: number;
      elbowR: number;
    }[];
  } | null;
  /** 모든 부위에 같은 굵기로 두르는 외곽선. */
  outline: number;
  head: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    angleDeg: number;
    hair: string;
  } | null;
  face: {
    eyes: { center: Point; closed: boolean; dotR: number; half: number; stroke: number }[];
    brows: string[];
    browWidth: number;
    mouth: string;
    mouthFilled: boolean;
    mouthStroke: number;
  } | null;
  hands: {
    shapes: { d: string; width: number }[];
    joints: { center: Point; r: number }[];
  }[];
}

function buildFigure(at: At, baseline: HeadBaseline): Figure {
  const unit = span(at(POSE.leftShoulder), at(POSE.rightShoulder));

  return {
    outline: unit * OUTLINE_WIDTH,
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
  if (![ls, rs, lh, rh].every(ok)) return null;

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
    torso: `M${pt(ls)}L${pt(rs)}L${pt(rh)}L${pt(lh)}Z`,
    torsoRound: unit * LIMB.torsoRound,
    neck,
    arms,
  };
}

/**
 * 문장 전체에서 한 번만 정하는 머리 기준값 — 크기와 기울기.
 *
 * 사람이 재생 도중 갑자기 커지거나 작아질 리 없다. 매 프레임 재면 잡음만 따라온다.
 */
export interface HeadBaseline {
  eyeSpan: number;
  angleDeg: number;
}

/**
 * 머리의 축 — 위치는 프레임마다, **크기와 각도는 문장 전체의 기준값**에서 온다.
 *
 * 크기·각도를 매 프레임 얼굴 랜드마크에서 다시 재면 머리가 떤다(실측 방향 전환율
 * 40%·37% — 대부분 측정 잡음). 위치는 실제 움직임이라(8~15%) 그대로 따라간다.
 */
function headAxis(at: At, baseline: HeadBaseline) {
  const left = at(FACE_POINTS.leftEyeOuter);
  const right = at(FACE_POINTS.rightEyeOuter);
  if (![left, right].every(ok)) return null;

  const rawAngle = (Math.atan2(left[1] - right[1], left[0] - right[0]) * 180) / Math.PI;
  const deviation = rawAngle - baseline.angleDeg;
  const beyond = Math.abs(deviation) - HEAD.angleDeadbandDeg;
  const angleDeg =
    beyond > 0
      ? baseline.angleDeg + Math.sign(deviation) * beyond * HEAD.angleGain
      : baseline.angleDeg;

  // 얼굴의 '아래' 는 눈 축에 수직이다. 눈–입 벡터로 재면 입술 잡음까지 따라 들어온다.
  const radians = (angleDeg * Math.PI) / 180;
  return {
    eyeMid: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2] as Point,
    eyeSpan: baseline.eyeSpan,
    down: [-Math.sin(radians), Math.cos(radians)] as Point,
    angleDeg,
  };
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

  return { cx, cy, rx, ry, angleDeg: axis.angleDeg, hair };
}

function buildFace(at: At, baseline: HeadBaseline): Figure['face'] {
  const axis = headAxis(at, baseline);
  if (!axis) return null;

  const [cx, cy] = headCenter(axis);
  const rx = axis.eyeSpan * HEAD.halfWidth;
  const ry = rx * HEAD.heightRatio;

  const eyes: NonNullable<Figure['face']>['eyes'] = [];
  const brows: string[] = [];

  for (const side of [
    {
      dir: -1,
      outer: FACE_POINTS.rightEyeOuter,
      inner: FACE_POINTS.rightEyeInner,
      upper: FACE_POINTS.rightEyeUpper,
      lower: FACE_POINTS.rightEyeLower,
      brow: RIGHT_BROW,
    },
    {
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

    eyes.push({
      center: [eyeX, eyeY],
      closed: span(upper, lower) / eyeWidth < EYE.closedBelow,
      dotR: rx * EYE.dotR,
      half: rx * EYE.closedHalf,
      stroke: rx * EYE.closedStroke,
    });

    // 눈썹 — 얇은 호. 높이만 데이터에서 오되 **잡음 폭은 통째로 무시한다**.
    const browPoints = side.brow.map(at);
    if (!browPoints.every(ok)) continue;
    const lift =
      rx * (EYE.browLift + browShift(span(browPoints[0], upper) / eyeWidth));
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

  return {
    eyes,
    brows,
    browWidth: rx * EYE.browStroke,
    mouth,
    mouthFilled: filled,
    mouthStroke: rx * MOUTH.stroke,
  };
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


// ---------------------------------------------------------------- 헬퍼

/**
 * 볼록 껍질 (모노톤 체인). 점이 대여섯 개라 비용은 무시할 수준이다.
 *
 * 순서가 뒤엉킨 점들을 **꼬이지 않는 다각형**으로 만든다. 손이 돌아가면 엄지 뿌리가
 * 반대쪽으로 넘어가 손바닥 다각형이 스스로 꼬이는데, 꼬인 면은 외곽선을 두르는 순간
 * 삐죽한 조각으로 드러난다.
 */
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;

  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const build = (source: readonly Point[]) => {
    const chain: Point[] = [];
    for (const point of source) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0
      ) {
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };

  const hull = [...build(sorted), ...build([...sorted].reverse())];
  return hull.length >= 3 ? hull : sorted;
}

function ok(point: Point): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function pt(point: Point): string {
  return `${point[0].toFixed(1)} ${point[1].toFixed(1)}`;
}

function span(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * 점들을 닫힌 **곡선**으로. 각 변의 중점을 지나고 원래 점을 제어점으로 쓴다.
 *
 * 직선으로 이으면 눈·입이 다각형으로 보인다 — 78점은 윤곽을 성기게 표현한 서브셋이라
 * 그 각짐이 그대로 드러난다. 곡선은 점을 옮기지 않고 사이만 메우므로 정보를 더하지 않는다.
 */
function smoothRing(points: readonly Point[]): string {
  if (points.length < 3) return '';
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[points.length - 1], points[0]);
  let d = `M${pt(start)}`;
  for (let i = 0; i < points.length; i += 1) {
    const control = points[i];
    const end = mid(points[i], points[(i + 1) % points.length]);
    d += `Q${pt(control)} ${pt(end)}`;
  }
  return `${d}Z`;
}

function smoothRingAt(indices: readonly number[], at: At): string | null {
  const points = indices.map(at);
  if (!points.every(ok)) return null;
  return smoothRing(points);
}

/** 두 점 사이를 굵기가 변하는 사다리꼴로 — 팔다리에 살을 붙인다. */
function taper(a: Point, b: Point, halfA: number, halfB: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const corners: Point[] = [
    [a[0] + nx * halfA, a[1] + ny * halfA],
    [b[0] + nx * halfB, b[1] + ny * halfB],
    [b[0] - nx * halfB, b[1] - ny * halfB],
    [a[0] - nx * halfA, a[1] - ny * halfA],
  ];
  return `M${corners.map(pt).join('L')}Z`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
