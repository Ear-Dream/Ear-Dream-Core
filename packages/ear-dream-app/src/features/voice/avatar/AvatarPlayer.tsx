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
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { PAINT } from './avatarTuning';
import { buildFigure, headBaselineOf, sequenceCrop } from './figure';
import type { SignSequence } from './sequenceFiles';
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
