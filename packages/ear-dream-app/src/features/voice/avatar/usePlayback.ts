/**
 * 시퀀스 재생 타임라인 — "몇 번째 프레임의 어느 좌표인가"만 담당한다.
 *
 * 렌더러(`AvatarPlayer`)와 분리해 둔 이유는 **전환 보간이 두 벌이 되는 것**을 막기
 * 위해서다 — 보간 규칙이 갈리면 같은 문장이 그리는 방식마다 다르게 움직인다.
 *
 * ## 표시 시점 보간 둘
 *
 * **단어 사이 전환** — 단어마다 끝 자세와 다음 단어의 시작 자세가 달라 그냥 이어
 * 붙이면 뚝뚝 끊긴다. 경계에 짧은 전환 구간을 넣어 두 자세 사이를 잇는다.
 *
 * **짧은 결측 메우기** — 검출기가 한두 프레임씩 부위를 놓쳐서 손·머리가 깜빡인다.
 * 앞뒤 관측 사이를 이어 메운다 (`MAX_FILL_FRAMES`).
 *
 * ⚠️ 둘 다 CLAUDE.md 「전처리 정본은 한 곳」이 금지하는 클라이언트 보간이 **아니다.**
 * 그 규칙은 **모델로 가는 데이터**를 두 곳에서 가공하면 train/serve skew 가 난다는
 * 이야기다. 여기 좌표는 화면에 그려질 뿐 서버로도 모델로도 가지 않는다 — 화면 크기에
 * 맞춰 스케일하는 것과 같은 층위의 표시 처리다. **원본 시퀀스는 건드리지 않고**
 * 재생 시점에만 중간 자세를 계산한다.
 *
 * ## 좌표계
 *
 * 시퀀스는 **16:9 기준 정규화 좌표**(0~1)다. 세로 화면에 그대로 늘리면 사람이 옆으로
 * 퍼지므로, 담을 범위(`crop`)의 실제 종횡비를 지키는 상자를 만들어 그 안에 매핑한다.
 * 그래서 `at()` 이 돌려주는 픽셀 좌표는 **가로세로 비율이 실제와 같다** — 길이·각도를
 * 계산해도 왜곡되지 않는다(아바타 렌더러가 이 성질에 기댄다).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import type { SignSequence } from './sequenceFiles';

/** 시퀀스 좌표계의 종횡비 — 정규화 좌표 1×1 이 실제로는 16:9 다. */
export const SOURCE_ASPECT = 16 / 9;

/**
 * 무대에 담을 좌표 범위 (정규화 좌표). 기본은 원본 화각 전체다.
 *
 * 인물이 화면 가로의 30% 남짓만 차지해서, 전체를 담으면 양옆이 거의 빈 채로 인물만
 * 작아진다. 호출자가 인물 범위를 계산해 넘기면 그만큼 크게 그려진다.
 */
export interface Crop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const FULL_FRAME: Crop = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * 단어 사이 전환에 쓰는 프레임 수.
 *
 * **프로토타입 임시값 — 확정 아님.** 30fps 기준 6프레임 = 200ms 로, 끊김이 사라지면서도
 * 원래 동작보다 눈에 띄게 느려지지 않는 지점으로 골랐다. 수어에서 단어 경계의 자연스러운
 * 길이가 얼마인지는 이 레포에 실측이 없다 — 사용자 확인 후 조정한다.
 */
export const DEFAULT_TRANSITION_FRAMES = 6;

/**
 * 짧은 결측 구간을 앞뒤로 이어 메울 최대 길이(프레임).
 *
 * 검출기는 한두 프레임씩 부위를 놓친다. 그대로 그리면 손이나 머리가 **깜빡인다** —
 * 300단어 실측: 손 결측 구간 157개가 전부 1프레임, 얼굴 19개 구간의 중앙값 2 ·
 * 최대 11프레임이다. 사람이 그 사이 사라졌을 리 없으니 메우는 게 사실에 가깝다.
 *
 * 상한을 두는 이유는 **길게 빈 것은 진짜 없는 것**이기 때문이다. 인물이 화면을
 * 벗어나거나 손이 완전히 가려진 구간까지 이어 버리면 없는 자세를 지어내게 된다.
 * 12프레임(400ms)은 실측 최대(11)를 막 덮는 값이라, 지금 시퀀스에서는 전부 메워지고
 * 그보다 긴 결측이 생기면 그때는 안 메운다.
 *
 * ⚠️ 이것도 **표시 전용**이다. 이 좌표는 서버로도 모델로도 가지 않는다(모듈 상단
 * 「단어 사이 전환 보간」의 같은 논거). 원본 시퀀스는 건드리지 않는다.
 */
const MAX_FILL_FRAMES = 12;

/** 재생 타임라인의 한 구간. 단어 재생과 전환이 번갈아 놓인다. */
type Segment =
  | { kind: 'word'; index: number; length: number }
  | { kind: 'transition'; from: number; to: number; length: number };

export interface Stage {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaybackOptions {
  sequences: readonly SignSequence[];
  fps: number;
  playing: boolean;
  restartToken?: number;
  transitionFrames?: number;
  onFinished?: () => void;
  onWordChange?: (index: number) => void;
  /** 담을 좌표 범위. 생략하면 원본 화각 전체. */
  crop?: Crop;
}

export interface PlaybackState {
  /** 컨테이너 크기. `<Svg width height>` 에 그대로 쓴다. */
  box: { width: number; height: number };
  /** 컨테이너의 onLayout 에 그대로 연결한다. */
  onLayout: (event: LayoutChangeEvent) => void;
  /** 컨테이너 안에 들어간 무대. 크기를 모르면 null. */
  stage: Stage | null;
  /** 현재 프레임의 키포인트 → 화면 픽셀. 무대가 없거나 재생할 게 없으면 null. */
  at: ((keypoint: number) => readonly [number, number]) | null;
}

export function useSequencePlayback({
  sequences,
  fps,
  playing,
  restartToken = 0,
  transitionFrames = DEFAULT_TRANSITION_FRAMES,
  onFinished,
  onWordChange,
  crop = FULL_FRAME,
}: PlaybackOptions): PlaybackState {
  const [box, setBox] = useState({ width: 0, height: 0 });
  // 타임라인 전체에서의 프레임 번호.
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

  // 컨테이너 안에 들어가는 상자 (contain). 늘이지 않고 남는 쪽을 비운다 —
  // 잘라낸 범위의 **실제** 종횡비를 지켜야 사람이 옆으로 퍼지지 않는다.
  const stage = useMemo(() => {
    if (box.width === 0 || box.height === 0) return null;
    const spanX = crop.x1 - crop.x0;
    const spanY = crop.y1 - crop.y0;
    if (spanX <= 0 || spanY <= 0) return null;
    const aspect = (spanX * SOURCE_ASPECT) / spanY;
    const width = Math.min(box.width, box.height * aspect);
    const height = width / aspect;
    return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
  }, [box, crop.x0, crop.y0, crop.x1, crop.y1]);

  /** 현재 프레임의 좌표 조회기 + 지금 그리고 있는 단어. */
  const resolved = useMemo(
    () => resolveFrame(timeline.segments, sequences, frame),
    [timeline, sequences, frame],
  );

  useEffect(() => {
    if (resolved) onWordChangeRef.current?.(resolved.wordIndex);
  }, [resolved?.wordIndex]);

  const at = useMemo(() => {
    if (!resolved || !stage) return null;
    const spanX = crop.x1 - crop.x0;
    const spanY = crop.y1 - crop.y0;
    return (keypoint: number): readonly [number, number] => {
      const [x, y] = resolved.sample(keypoint);
      return [
        stage.x + ((x - crop.x0) / spanX) * stage.width,
        stage.y + ((y - crop.y0) / spanY) * stage.height,
      ];
    };
  }, [resolved, stage, crop.x0, crop.y0, crop.x1, crop.y1]);

  return {
    box,
    stage,
    at,
    onLayout: (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    },
  };
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
        sample: (kp) => sampleFrame(sequence, remaining, kp),
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
        const [x1, y1] = sampleFrame(from, from.frameCount - 1, kp);
        const [x2, y2] = sampleFrame(to, 0, kp);
        // 한쪽이라도 미검출이면 보간하지 않는다 — 없는 자세를 지어내는 셈이 된다.
        // x·y 를 모두 본다: 이 시퀀스에서는 둘이 함께 결측이지만 그 가정에 기대지 않는다.
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

/**
 * 결측이면 앞뒤에서 관측된 값을 찾아 선형 보간한다. 못 찾으면 결측 그대로 둔다.
 *
 * **양쪽이 다 있어야 메운다.** 한쪽만으로 이으면 보간이 아니라 외삽이고, 클립의 처음·
 * 끝에서 있지도 않은 자세를 만들어 낸다. 상한(`MAX_FILL_FRAMES`)을 넘는 구간도 그대로 둔다.
 */
function sampleFrame(sequence: SignSequence, frame: number, kp: number): [number, number] {
  const direct = readFrame(sequence, frame, kp);
  if (Number.isFinite(direct[0]) && Number.isFinite(direct[1])) return direct;

  let before: { frame: number; xy: [number, number] } | null = null;
  for (let step = 1; step <= MAX_FILL_FRAMES && frame - step >= 0; step += 1) {
    const xy = readFrame(sequence, frame - step, kp);
    if (Number.isFinite(xy[0]) && Number.isFinite(xy[1])) {
      before = { frame: frame - step, xy };
      break;
    }
  }
  if (!before) return direct;

  for (let step = 1; step <= MAX_FILL_FRAMES && frame + step < sequence.frameCount; step += 1) {
    const xy = readFrame(sequence, frame + step, kp);
    if (Number.isFinite(xy[0]) && Number.isFinite(xy[1])) {
      // 두 관측 사이가 상한보다 길면 메우지 않는다 — 가운데를 지어내는 셈이 된다.
      const span = frame + step - before.frame;
      if (span > MAX_FILL_FRAMES) break;
      const t = (frame - before.frame) / span;
      return [
        before.xy[0] + (xy[0] - before.xy[0]) * t,
        before.xy[1] + (xy[1] - before.xy[1]) * t,
      ];
    }
  }
  return direct;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}
