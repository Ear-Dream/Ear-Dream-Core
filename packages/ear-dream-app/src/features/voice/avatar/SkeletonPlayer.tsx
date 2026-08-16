/**
 * 수어 스켈레톤 재생기.
 *
 * 단어 시퀀스를 순서대로 이어 재생한다. 좌표는 빌트인 자산(sequenceAssets)에서 오고,
 * 이 컴포넌트는 **그리기만** 한다 — 좌표를 가공하지 않는다(스무딩·보간 금지,
 * CLAUDE.md 「전처리 정본은 한 곳」).
 *
 * ## 프레임마다 React 를 다시 그리지 않는다
 *
 * 130점을 선/점 요소로 하나씩 만들면 프레임당 130여 개 엘리먼트가 갱신된다. 대신
 * **그룹당 Path 하나**로 합쳐 프레임당 갱신 대상을 4개(포즈·왼손·오른손·얼굴)로 줄였다.
 * SVG 로 골격을 그리는 자연스러운 방식이기도 하다.
 *
 * ## 좌표계
 *
 * 자산은 **16:9 기준 정규화 좌표**(0~1)다. 세로 화면에 그대로 늘리면 사람이 옆으로
 * 퍼지므로, 컨테이너 안에 16:9 상자를 넣고(레터박스) 그 안에 매핑한다 — 잘라내면
 * 손이 프레임 밖으로 나간다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radius } from '../../../constants/theme';
import {
  FACE_POINT_RANGE,
  LEFT_HAND_EDGES,
  POSE_EDGES,
  RIGHT_HAND_EDGES,
} from './connections';
import type { SignSequence } from './sequenceAssets';

/** 자산의 좌표 종횡비. 세로 화면에 맞출 때 이 비율의 상자를 만든다. */
const SOURCE_ASPECT = 16 / 9;

export interface SkeletonPlayerProps {
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
  /** 마지막 시퀀스의 마지막 프레임까지 그린 뒤 한 번 호출된다. */
  onFinished?: () => void;
  /** 지금 몇 번째 단어를 그리고 있는지 — 화면이 단어를 강조할 때 쓴다. */
  onWordChange?: (index: number) => void;
  testID?: string;
}

export function SkeletonPlayer({
  sequences,
  fps,
  playing,
  restartToken = 0,
  onFinished,
  onWordChange,
  testID,
}: SkeletonPlayerProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  // 프레임 커서. 렌더를 유발해야 하므로 state 지만, 갱신되는 SVG 요소는 4개뿐이다.
  const [cursor, setCursor] = useState({ word: 0, frame: 0 });

  const onFinishedRef = useRef(onFinished);
  const onWordChangeRef = useRef(onWordChange);
  onFinishedRef.current = onFinished;
  onWordChangeRef.current = onWordChange;

  // 시퀀스가 바뀌거나 다시 재생 신호가 오면 처음부터.
  useEffect(() => {
    setCursor({ word: 0, frame: 0 });
  }, [sequences, restartToken]);

  useEffect(() => {
    if (!playing || sequences.length === 0 || fps <= 0) return;

    let raf = 0;
    let cancelled = false;
    // 경과 시간으로 프레임을 정한다 — 느린 기기에서 프레임을 건너뛸지언정
    // 재생 속도(초 단위 길이)는 유지된다.
    const startedAt = performance.now();
    const frameDurationMs = 1000 / fps;
    const totals = sequences.map((s) => s.frameCount);
    const grandTotal = totals.reduce((sum, n) => sum + n, 0);

    const tick = () => {
      if (cancelled) return;
      const elapsedFrames = Math.floor((performance.now() - startedAt) / frameDurationMs);

      if (elapsedFrames >= grandTotal) {
        const lastWord = sequences.length - 1;
        setCursor({ word: lastWord, frame: totals[lastWord] - 1 });
        onFinishedRef.current?.();
        return;
      }

      let remaining = elapsedFrames;
      let word = 0;
      while (word < totals.length && remaining >= totals[word]) {
        remaining -= totals[word];
        word += 1;
      }
      setCursor((prev) =>
        prev.word === word && prev.frame === remaining ? prev : { word, frame: remaining },
      );
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // restartToken 이 바뀌면 이 effect 가 다시 돌아 startedAt 이 초기화된다.
  }, [playing, sequences, fps, restartToken]);

  useEffect(() => {
    onWordChangeRef.current?.(cursor.word);
  }, [cursor.word]);

  // 컨테이너 안에 들어가는 16:9 상자 (contain). 늘이지 않고 남는 쪽을 비운다.
  const stage = useMemo(() => {
    if (box.width === 0 || box.height === 0) return null;
    const width = Math.min(box.width, box.height * SOURCE_ASPECT);
    const height = width / SOURCE_ASPECT;
    return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
  }, [box]);

  const paths = useMemo(() => {
    const sequence = sequences[cursor.word];
    if (!sequence || !stage) return null;
    const at = (kp: number): [number, number] => {
      const base = (cursor.frame * sequence.keypointCount + kp) * 2;
      return [
        stage.x + sequence.xy[base] * stage.width,
        stage.y + sequence.xy[base + 1] * stage.height,
      ];
    };
    return {
      pose: edgePath(POSE_EDGES, at),
      leftHand: edgePath(LEFT_HAND_EDGES, at),
      rightHand: edgePath(RIGHT_HAND_EDGES, at),
      face: dotPath(FACE_POINT_RANGE[0], FACE_POINT_RANGE[1], at),
    };
  }, [sequences, cursor, stage]);

  return (
    <View
      style={styles.root}
      testID={testID}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {stage ? (
        <Svg width={box.width} height={box.height}>
          {/* 16:9 무대 — 어디까지가 카메라 화각이었는지 보이게 한다. */}
          <Rect
            x={stage.x}
            y={stage.y}
            width={stage.width}
            height={stage.height}
            rx={radius.md}
            fill={colors.bg.surface}
          />
          {paths ? (
            <>
              <Path
                d={paths.face}
                stroke={colors.text.secondary}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d={paths.pose}
                stroke={colors.text.primary}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <Path
                d={paths.leftHand}
                stroke={colors.brand.primary}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <Path
                d={paths.rightHand}
                stroke={colors.brand.primary}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** 연결선들을 Path 하나로. 양 끝 중 하나라도 미검출(NaN)이면 그 선은 건너뛴다. */
function edgePath(
  edges: readonly (readonly [number, number])[],
  at: (kp: number) => [number, number],
): string {
  let d = '';
  for (const [from, to] of edges) {
    const [x1, y1] = at(from);
    const [x2, y2] = at(to);
    if (!Number.isFinite(x1) || !Number.isFinite(y1)) continue;
    if (!Number.isFinite(x2) || !Number.isFinite(y2)) continue;
    d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return d;
}

/**
 * 점들을 Path 하나로. 길이 0에 가까운 선분 + round cap 이 곧 점이다
 * (Circle 을 78개 만들면 프레임마다 78개 엘리먼트가 갱신된다).
 */
function dotPath(start: number, end: number, at: (kp: number) => [number, number]): string {
  let d = '';
  for (let kp = start; kp < end; kp += 1) {
    const [x, y] = at(kp);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    d += `M${x.toFixed(1)} ${y.toFixed(1)}l0.1 0`;
  }
  return d;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
