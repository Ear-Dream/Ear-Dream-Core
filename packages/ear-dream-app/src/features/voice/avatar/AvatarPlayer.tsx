/**
 * 임시 3D풍 아바타 재생기 — `Figure` 를 SVG 로 옮긴다.
 *
 * 역할이 넷으로 갈려 있다. 이 파일은 마지막 하나만 맡는다.
 *
 *   `usePlayback`    재생 타임라인 · 단어 사이 전환 보간 · 좌표 접근자(`at`)
 *   `figure`         좌표 → 그릴 도형 (형상 계산, React 무관 순수 함수)
 *   `avatarTuning`   눈으로 맞춘 색·치수 (육안 검증에서 손대는 곳)
 *   `AvatarPlayer`   `Figure` 를 SVG 로 칠하기  ← 이 파일
 *
 * ## 이것은 3D 가 아니다
 *
 * 시퀀스가 **xy 2D**(`index.json` 의 `channel_count: 2`)라 실제 3D 리깅이 아니라
 * 명암·굵기로 입체감을 흉내 낸 2.5D 다. 그래서 **손바닥이 어느 쪽을 보는지 표현할 수
 * 없다** — 2D 점만으로는 전완 롤이 유일하게 정해지지 않는다. 수어에서 손바닥 방향은
 * 의미를 바꾸므로, 이 아바타는 "그럴듯해 보이지만 손바닥 방향은 틀릴 수 있는" 상태다.
 * 실사 아바타로 갈 거라면 좌표를 xyz 로 다시 뽑는 것이 선행 조건이다.
 *
 * ## 그리는 순서가 곧 겹침 순서다
 *
 * 부위마다 같은 도형을 외곽선 굵기로 한 번 깔고 그 위에 제 색을 얹는다. 겹친 도형들의
 * 바깥선만 남고 내부 경계는 덮이므로 도형 합집합을 구할 필요가 없다 — 대신 JSX 의
 * 순서가 의미를 가지므로 블록을 함부로 옮기지 말 것.
 */
import { type ReactNode, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  Path,
  Stop,
} from 'react-native-svg';

import { ARM_SPRITE, BODY_SPRITE, FACE_PART, PAINT } from './avatarTuning';
import { type FaceSprites, type Sprite, useAvatarSprites } from './avatarSprites';
import type { Figure } from './figure';
import { buildFigure, headBaselineOf, sequenceCrop } from './figure';
import type { SignSequence } from './sequenceFiles';
import type { Point } from './geometry';
import { span, spriteTransform } from './geometry';
import { useSequencePlayback } from './usePlayback';

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
    return { ...rawBaseline, eyeSpan: rawBaseline.eyeSpan * pxPerUnit };
  }, [rawBaseline, stage, crop.y0, crop.y1]);

  const figure = useMemo(
    () => (at && baseline ? buildFigure(at, baseline) : null),
    [at, baseline],
  );

  // 몸은 디자인 시트에서 잘라낸 그림으로 그린다. 못 받은 부위만 벡터로 돌아간다.
  const sprites = useAvatarSprites();

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
              {/* 머리 스프라이트는 목까지 한 장이라 **몸통보다 먼저** 깔린다 —
                  옷깃이 목 밑동을 덮어야 이어 붙인 자리가 안 보인다. 벡터 머리는
                  목이 따로 있어 순서가 반대다(아래 「벡터 머리」 블록). */}
              {sprites.head && sprites.face && figure.head ? (
                <BonePart
                  {...alignNeck(figure.head, BODY_SPRITE.headScale)}
                  sprite={sprites.head}
                  scale={BODY_SPRITE.headScale}
                >
                  {figure.face ? <FaceParts face={sprites.face} figure={figure.face} /> : null}
                </BonePart>
              ) : null}

              {figure.body ? (
                <G>
                  {sprites.torso ? (
                    <BonePart
                      sprite={sprites.torso}
                      start={figure.body.shoulderRight}
                      end={figure.body.shoulderLeft}
                      scale={BODY_SPRITE.torsoScale}
                    />
                  ) : (
                    <>
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
                      {figure.body.torso ? (
                        <>
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
                        </>
                      ) : null}
                    </>
                  )}
                  {figure.body.arms.map((arm, index) => {
                    const side = index === 0 ? 'Left' : 'Right';
                    const upper = sprites.arms?.[`upper${side}` as const];
                    const fore = sprites.arms?.[`fore${side}` as const];
                    if (upper && fore) {
                      // 굵기는 어깨 너비에 묶는다 — 관절 간격에 묶으면 팔이 카메라를
                      // 향할 때(원근 단축) 같이 가늘어진다.
                      const upperWidth = (figure.unit * ARM_SPRITE.upperWidth) / upper.width;
                      const foreWidth = (figure.unit * ARM_SPRITE.foreWidth) / fore.width;
                      return (
                        <G key={index}>
                          <G
                            transform={spriteTransform(
                              arm.shoulder,
                              arm.elbow,
                              upper.from,
                              upper.to,
                              upperWidth,
                            )}
                          >
                            <SvgImage
                              href={upper.uri}
                              width={upper.width}
                              height={upper.height}
                              preserveAspectRatio="none"
                            />
                          </G>
                          <G
                            transform={spriteTransform(
                              arm.elbow,
                              arm.wrist,
                              fore.from,
                              fore.to,
                              foreWidth,
                            )}
                          >
                            <SvgImage
                              href={fore.uri}
                              width={fore.width}
                              height={fore.height}
                              preserveAspectRatio="none"
                            />
                          </G>
                        </G>
                      );
                    }
                    return (
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
                    );
                  })}
                </G>
              ) : null}

              {/* 벡터 머리 — 스프라이트가 없을 때의 폴백이다. */}
              {!(sprites.head && sprites.face) && figure.head ? (
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

              {/* 눈·눈썹·입 — 벡터 머리에만 얹는다. 스프라이트 머리 쪽은 조각을
                  머리 그룹 안에서 그리므로(위 `FaceParts`) 여기 오지 않는다. */}
              {!(sprites.head && sprites.face) && figure.face ? (
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
 * 머리를 옷깃 구멍에 **좌우로만** 맞춘다 — 목 기둥의 중심이 몸통의 목 지점에 오도록.
 *
 * 머리는 눈에서, 몸통은 어깨에서 각자 자리를 잡아서 둘이 어긋난다. 목은 옷깃 안에
 * 들어가 있어야 하므로 그 어긋남이 이음매에 그대로 드러난다.
 *
 * 목 중심은 눈 축보다 한참 아래라 **고개가 기울면 좌우로 밀린다.** 그래서 단순히
 * 눈 중점을 맞추면 안 되고, 회전을 태운 만큼을 빼 줘야 한다 — 실측 기울기 3°에서
 * 그 성분이 3.8px 로, 고치려는 어긋남(3.3px)과 같은 크기다.
 *
 * 위아래는 **옷깃에 맞추지 않는다**(`FACE_PART.neckCenter` 주석 참고). 다만 보이는 목이
 * 길어 보여서 `BODY_SPRITE.headDrop` 만큼 머리를 제 축을 따라 내린다 — 내린 뒤의
 * 눈 중점으로 좌우를 맞춰야 목이 옷깃 가운데에 남는다.
 */
function alignNeck(head: NonNullable<Figure['head']>, headScale: number) {
  const { neckTarget } = head;
  const angle = Math.atan2(
    head.eyeLeft[1] - head.eyeRight[1],
    head.eyeLeft[0] - head.eyeRight[0],
  );
  // 머리를 제 축을 따라 조금 내려 보이는 목 길이를 줄인다 (`BODY_SPRITE.headDrop`).
  const drop = span(head.eyeRight, head.eyeLeft) * BODY_SPRITE.headDrop;
  const down: Point = [-Math.sin(angle) * drop, Math.cos(angle) * drop];
  const eyeRight: Point = [head.eyeRight[0] + down[0], head.eyeRight[1] + down[1]];
  const eyeLeft: Point = [head.eyeLeft[0] + down[0], head.eyeLeft[1] + down[1]];
  if (!neckTarget) return { start: eyeRight, end: eyeLeft };

  const spriteSpan = FACE_PART.eyeLeft[0] - FACE_PART.eyeRight[0];
  const scale = (span(eyeRight, eyeLeft) * headScale) / (spriteSpan || 1);

  // 눈 중점 → 목 중심 (그림 좌표) 을 화면으로 옮겼을 때의 가로 성분.
  const offsetX = FACE_PART.neckCenter[0] - (FACE_PART.eyeRight[0] + spriteSpan / 2);
  const offsetY = FACE_PART.neckCenter[1] - FACE_PART.eyeRight[1];
  const neckDx = scale * (offsetX * Math.cos(angle) - offsetY * Math.sin(angle));

  const shift = neckTarget[0] - ((eyeRight[0] + eyeLeft[0]) / 2 + neckDx);
  return {
    start: [eyeRight[0] + shift, eyeRight[1]] as Point,
    end: [eyeLeft[0] + shift, eyeLeft[1]] as Point,
  };
}

/**
 * 머리 그림 위의 눈·눈썹·입 — 데이터가 고른 조각을 제 자리에 얹는다.
 *
 * 머리 그림은 **이목구비가 비어 있다.** 그래서 덮는 것이 아니라 채우는 것이고,
 * 조각이 없으면 얼굴이 없다 — 그 경우 `sprites.face` 가 null 이라 머리 스프라이트도
 * 쓰지 않고 통째로 벡터로 내려간다.
 *
 * 눈썹만 단계가 아니라 **높이가 연속**이다. 눈과 분리된 조각이라 옮길 수 있고,
 * 좌표가 재는 것도 눈썹–눈 간격이라 그쪽이 데이터에 더 가깝다.
 */
function FaceParts({ face, figure }: { face: FaceSprites; figure: NonNullable<Figure['face']> }) {
  // 자리와 크기는 전부 **머리 그림 픽셀**이다(`FACE_PART`). 좌표가 정하는 것은 상태뿐이라
  // 여기서 데이터를 보고 바꾸는 값은 눈썹 높이 하나다.
  const bone = (center: readonly number[], width: number, dy = 0) => ({
    from: [center[0] - width / 2, center[1] + dy],
    to: [center[0] + width / 2, center[1] + dy],
  });
  const browDy = -figure.browLift * FACE_PART.browTravel;

  return (
    <>
      {/* 코가 먼저 — 눈·입보다 뒤에 깔린다(겹치지는 않지만 순서를 고정해 둔다). */}
      <FacePart sprite={face.nose} target={FACE_PART.nose} />
      {figure.eyes.map((eye) => {
        const right = eye.side === 'right';
        return (
          <G key={eye.side}>
            <FacePart
              sprite={face.eyes[eye.state][eye.side]}
              target={bone(right ? FACE_PART.eyeRight : FACE_PART.eyeLeft, FACE_PART.eyeWidth)}
            />
            <FacePart
              sprite={face.brows[eye.side]}
              target={bone(
                right ? FACE_PART.browRight : FACE_PART.browLeft,
                FACE_PART.browWidth,
                browDy,
              )}
            />
          </G>
        );
      })}
      <FacePart sprite={face.mouths[figure.mouthState]} target={FACE_PART.mouth} />
    </>
  );
}

/**
 * 스프라이트 한 장을 뼈(두 점) 위에 등방으로 꽂는다.
 *
 * `scale` 은 그림 전체를 **뼈의 중점을 축으로** 키우거나 줄인다. 1 이면 그림의 두
 * 앵커가 화면의 두 점에 정확히 얹힌다. 1 이 아니면 자리(중점)와 각도만 데이터를 따르고
 * 크기는 그 배수가 된다 — 시안 인물의 비례가 데이터 인물과 다를 때 맞추는 손잡이다.
 *
 * 팔의 `spriteTransform` 직접 호출과 다른 점: 팔은 길이와 굵기를 **따로** 준다(원근
 * 단축 때문에). 몸통·머리는 뼈가 화면과 거의 나란해서 그 문제가 없어 등방이 맞다.
 */
function BonePart({
  sprite,
  start,
  end,
  scale,
  children,
}: {
  sprite: Sprite;
  start: Point;
  end: Point;
  scale: number;
  /** 그림 **픽셀 좌표계**에서 그려진다 — 바깥 변환이 그대로 따라온다. */
  children?: ReactNode;
}) {
  const midX = (start[0] + end[0]) / 2;
  const midY = (start[1] + end[1]) / 2;
  const grow = (point: Point): Point => [
    midX + (point[0] - midX) * scale,
    midY + (point[1] - midY) * scale,
  ];
  const from = grow(start);
  const to = grow(end);
  const boneLength = span(sprite.from, sprite.to) || 1;
  return (
    <G transform={spriteTransform(from, to, sprite.from, sprite.to, span(from, to) / boneLength)}>
      <SvgImage
        href={sprite.uri}
        width={sprite.width}
        height={sprite.height}
        preserveAspectRatio="none"
      />
      {children}
    </G>
  );
}

/**
 * 눈·입 조각 하나를 머리 그림 위에 얹는다 — 좌표는 **머리 그림 픽셀**이다.
 *
 * 머리 그룹 안에서 그려지므로 머리의 회전·확대가 그대로 따라온다. 화면 좌표로
 * 환산하지 않는 것이 요점이다 — 환산하면 머리와 얼굴이 따로 놀 여지가 생긴다.
 */
function FacePart({
  sprite,
  target,
}: {
  sprite: Sprite;
  target: { from: readonly number[]; to: readonly number[] };
}) {
  const start: Point = [target.from[0], target.from[1]];
  const end: Point = [target.to[0], target.to[1]];
  const boneLength = span(sprite.from, sprite.to) || 1;
  return (
    <G transform={spriteTransform(start, end, sprite.from, sprite.to, span(start, end) / boneLength)}>
      <SvgImage
        href={sprite.uri}
        width={sprite.width}
        height={sprite.height}
        preserveAspectRatio="none"
      />
    </G>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
