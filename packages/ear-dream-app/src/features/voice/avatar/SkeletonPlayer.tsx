/**
 * 수어 스켈레톤 재생기.
 *
 * 단어 시퀀스를 순서대로 이어 재생한다. 좌표는 빌트인 자산(sequenceAssets)에서 온다.
 *
 * ## 단어 사이 전환 보간
 *
 * 단어마다 끝 자세와 다음 단어의 시작 자세가 달라 그냥 이어 붙이면 뚝뚝 끊긴다.
 * 그래서 경계에 **짧은 전환 구간**을 넣어 두 자세 사이를 부드럽게 잇는다.
 *
 * ⚠️ 이것은 CLAUDE.md 「전처리 정본은 한 곳」이 금지하는 클라이언트 보간이 **아니다.**
 * 그 규칙은 **모델로 가는 데이터**를 두 곳에서 가공하면 train/serve skew 가 난다는
 * 이야기다. 여기 좌표는 화면에 그려질 뿐 서버로도 모델로도 가지 않는다 — 화면 크기에
 * 맞춰 스케일하는 것과 같은 층위의 표시 처리다. **원본 시퀀스는 건드리지 않고**
 * 재생 시점에만 중간 자세를 계산한다.
 *
 * ## 프레임마다 React 를 다시 그리지 않는다
 *
 * 130점을 선/점 요소로 하나씩 만들면 프레임당 130여 개 엘리먼트가 갱신된다. 대신
 * **그룹당 Path 하나**로 합쳐 프레임당 갱신 대상을 4개(포즈·왼손·오른손·얼굴)로 줄였다.
 *
 * ## 좌표계
 *
 * 자산은 **16:9 기준 정규화 좌표**(0~1)다. 세로 화면에 그대로 늘리면 사람이 옆으로
 * 퍼지므로, 컨테이너 안에 16:9 상자를 넣고(레터박스) 그 안에 매핑한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radius } from '../../../constants/theme';
import { FACE_POINT_RANGE, LEFT_HAND_EDGES, POSE_EDGES, RIGHT_HAND_EDGES } from './connections';
import type { SignSequence } from './sequenceAssets';

/** 자산의 좌표 종횡비. 세로 화면에 맞출 때 이 비율의 상자를 만든다. */
const SOURCE_ASPECT = 16 / 9;

/**
 * 단어 사이 전환에 쓰는 프레임 수.
 *
 * **프로토타입 임시값 — 확정 아님.** 30fps 기준 6프레임 = 200ms 로, 끊김이 사라지면서도
 * 원래 동작보다 눈에 띄게 느려지지 않는 지점으로 골랐다. 수어에서 단어 경계의 자연스러운
 * 길이가 얼마인지는 이 레포에 실측이 없다 — 사용자 확인 후 조정한다.
 */
export const DEFAULT_TRANSITION_FRAMES = 6;

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
  /** 단어 사이 전환 프레임 수. 0 이면 전환 없이 바로 붙는다. */
  transitionFrames?: number;
  /** 마지막 프레임까지 그린 뒤 한 번 호출된다. */
  onFinished?: () => void;
  /** 지금 몇 번째 단어를 그리고 있는지. 전환 중에는 들어가는 쪽 단어를 알린다. */
  onWordChange?: (index: number) => void;
  testID?: string;
}

/** 재생 타임라인의 한 구간. 단어 재생과 전환이 번갈아 놓인다. */
type Segment =
  | { kind: 'word'; index: number; length: number }
  | { kind: 'transition'; from: number; to: number; length: number };

export function SkeletonPlayer({
  sequences,
  fps,
  playing,
  restartToken = 0,
  transitionFrames = DEFAULT_TRANSITION_FRAMES,
  onFinished,
  onWordChange,
  testID,
}: SkeletonPlayerProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  // 타임라인 전체에서의 프레임 번호. 갱신되는 SVG 요소는 4개뿐이다.
  const [frame, setFrame] = useState(0);

  const onFinishedRef = useRef(onFinished);
  const onWordChangeRef = useRef(onWordChange);
  onFinishedRef.current = onFinished;
  onWordChangeRef.current = onWordChange;

  /** 단어 · 전환 · 단어 … 순으로 늘어놓은 재생 구간. */
  const timeline = useMemo(() => {
    const segments: Segment[] = [];
    sequences.forEach((sequence, index) => {
      if (index > 0 && transitionFrames > 0) {
        segments.push({ kind: 'transition', from: index - 1, to: index, length: transitionFrames });
      }
      segments.push({ kind: 'word', index, length: sequence.frameCount });
    });
    return { segments, total: segments.reduce((sum, s) => sum + s.length, 0) };
  }, [sequences, transitionFrames]);

  // 시퀀스가 바뀌거나 다시 재생 신호가 오면 처음부터.
  useEffect(() => {
    setFrame(0);
  }, [sequences, restartToken]);

  useEffect(() => {
    if (!playing || timeline.total === 0 || fps <= 0) return;

    let raf = 0;
    let cancelled = false;
    // 경과 시간으로 프레임을 정한다 — 느린 기기에서 프레임을 건너뛸지언정
    // 재생 속도(초 단위 길이)는 유지된다.
    const startedAt = performance.now();
    const frameDurationMs = 1000 / fps;

    const tick = () => {
      if (cancelled) return;
      const elapsed = Math.floor((performance.now() - startedAt) / frameDurationMs);
      if (elapsed >= timeline.total) {
        setFrame(timeline.total - 1);
        onFinishedRef.current?.();
        return;
      }
      setFrame((prev) => (prev === elapsed ? prev : elapsed));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // restartToken 이 바뀌면 이 effect 가 다시 돌아 startedAt 이 초기화된다.
  }, [playing, timeline, fps, restartToken]);

  // 컨테이너 안에 들어가는 16:9 상자 (contain). 늘이지 않고 남는 쪽을 비운다.
  const stage = useMemo(() => {
    if (box.width === 0 || box.height === 0) return null;
    const width = Math.min(box.width, box.height * SOURCE_ASPECT);
    const height = width / SOURCE_ASPECT;
    return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
  }, [box]);

  /** 현재 프레임의 좌표 조회기 + 지금 그리고 있는 단어. */
  const resolved = useMemo(
    () => resolveFrame(timeline.segments, sequences, frame),
    [timeline, sequences, frame],
  );

  useEffect(() => {
    if (resolved) onWordChangeRef.current?.(resolved.wordIndex);
  }, [resolved?.wordIndex]);

  const paths = useMemo(() => {
    if (!resolved || !stage) return null;
    const at = (kp: number): [number, number] => {
      const [x, y] = resolved.sample(kp);
      return [stage.x + x * stage.width, stage.y + y * stage.height];
    };
    return {
      pose: edgePath(POSE_EDGES, at),
      leftHand: edgePath(LEFT_HAND_EDGES, at),
      rightHand: edgePath(RIGHT_HAND_EDGES, at),
      face: dotPath(FACE_POINT_RANGE[0], FACE_POINT_RANGE[1], at),
    };
  }, [resolved, stage]);

  return (
    <View
      style={styles.root}
      testID={testID}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
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

/**
 * 타임라인 위의 프레임 번호를 좌표 조회기로 바꾼다.
 *
 * 단어 구간이면 그 프레임을 그대로 읽고, 전환 구간이면 앞 단어의 **마지막 자세**와 뒤
 * 단어의 **첫 자세** 사이를 보간한다.
 */
function resolveFrame(
  segments: readonly Segment[],
  sequences: readonly SignSequence[],
  frame: number,
): { wordIndex: number; sample: (kp: number) => [number, number] } | null {
  let remaining = frame;
  for (const segment of segments) {
    if (remaining >= segment.length) {
      remaining -= segment.length;
      continue;
    }
    if (segment.kind === 'word') {
      const sequence = sequences[segment.index];
      if (!sequence) return null;
      return {
        wordIndex: segment.index,
        sample: (kp) => readFrame(sequence, remaining, kp),
      };
    }
    const from = sequences[segment.from];
    const to = sequences[segment.to];
    if (!from || !to) return null;
    // ease-in-out — 선형은 시작과 끝이 툭 튀어 오히려 기계적으로 보인다.
    const t = smoothstep((remaining + 1) / (segment.length + 1));
    return {
      wordIndex: segment.to,
      sample: (kp) => {
        const [x1, y1] = readFrame(from, from.frameCount - 1, kp);
        const [x2, y2] = readFrame(to, 0, kp);
        // 한쪽이라도 미검출이면 보간하지 않는다 — 없는 자세를 지어내는 셈이 된다.
        // x·y 를 모두 본다: 이 자산에서는 둘이 함께 결측이지만 그 가정에 기대지 않는다.
        if (
          !Number.isFinite(x1) ||
          !Number.isFinite(y1) ||
          !Number.isFinite(x2) ||
          !Number.isFinite(y2)
        ) {
          return [Number.NaN, Number.NaN];
        }
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      },
    };
  }
  return null;
}

function readFrame(sequence: SignSequence, frame: number, kp: number): [number, number] {
  const base = (frame * sequence.keypointCount + kp) * 2;
  return [sequence.xy[base], sequence.xy[base + 1]];
}

/** 0→1 을 부드럽게 가속·감속. */
function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
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
