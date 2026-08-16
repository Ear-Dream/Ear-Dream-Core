/**
 * 세그먼트 레코더 (T-23) — "버튼을 누르는 동안" 이 단어 하나다 (boundary_mode: manual).
 *
 * 동작:
 *   - 평상시: onFrame 스냅샷을 프리롤 링 버퍼(PRE_ROLL_MS)에 유지한다.
 *   - start(): 링 버퍼 내용(누르기 직전 프레임)을 시드로 기록을 시작한다.
 *   - stop(): 포스트롤(POST_ROLL_MS)만큼 더 모은 뒤 SignSegment 로 resolve 한다.
 *
 * 규칙 준수 메모:
 *   - 좌표는 **가공하지 않는다**(반올림 포함). 스냅샷의 frame 배열(원본 정규화 좌표)을
 *     그대로 계약 필드에 담는다. 정규화·스케일링·대치는 전부 서버 소관이다(설계 결정 1).
 *   - face 는 스냅샷의 `face`(그 프레임의 관측값)만 쓴다. `displayFace`(표시용 hold)는
 *     버퍼·전송 금지다 — types.ts 의 face 주석 참고.
 *   - 타입은 전부 `@ear-dream/core` 생성 타입이다. 손으로 정의하지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LandmarkFrame, SignSegment } from '@ear-dream/core';

import { CAMERA_CONSTRAINTS_HINT, LANDMARKER_MODEL_VERSIONS } from '../landmarks/config';
import { PREVIEW_MIRRORED } from '../landmarks/handedness';
import type { LandmarkSnapshot } from '../landmarks/types';
import {
  CLIENT_VERSION,
  POST_ROLL_MS,
  POST_ROLL_TIMEOUT_GRACE_MS,
  PRE_ROLL_MS,
} from './config';

/** 스냅샷 → 계약 프레임 변환. 좌표 배열은 참조 그대로 옮기고 어떤 연산도 하지 않는다. */
function toLandmarkFrame(snapshot: LandmarkSnapshot): LandmarkFrame {
  return {
    t_ms: snapshot.timestampMs,
    hands: snapshot.hands.map((hand) => ({
      handedness_label: hand.handednessLabel,
      handedness_score: hand.handednessScore,
      landmarks: hand.frame,
    })),
    // 관측값만 보낸다. displayFace 는 결측치 대치라 서버가 진짜 관측과 구분할 수 없게 된다.
    face: snapshot.face ? { landmarks: snapshot.face.frame } : null,
    pose: snapshot.pose
      ? {
          landmarks: snapshot.pose.frame,
          visibility: [...snapshot.pose.visibility],
          world_landmarks: snapshot.pose.worldLandmarks,
        }
      : null,
  };
}

interface CaptureSource {
  sourceWidth: number;
  sourceHeight: number;
  delegate: string;
}

interface ActiveRecording {
  pressStartMs: number;
  frames: LandmarkFrame[];
  /** 기록 도중 입력 해상도가 바뀌었는지. true 면 이 세그먼트는 폐기한다 — onFrame 주석 참고. */
  geometryChanged: boolean;
}

interface PendingStop {
  pressEndMs: number;
  resolve: (result: SegmentStopResult) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * stop() 결과.
 *
 * "세그먼트 없음" 을 null 하나로 뭉뚱그리지 않는다 — 사용자가 해야 할 일이 다르기 때문이다.
 * empty 는 기다렸다 다시 누르면 되고, geometry-changed 는 폰을 세로로 되돌려야 한다.
 */
export type SegmentStopResult =
  | { kind: 'segment'; segment: SignSegment }
  /** 기록 중이 아니었거나 프레임이 전혀 없었다(카메라 정지 등). */
  | { kind: 'empty' }
  /** 기록 도중 입력 해상도(좌표계)가 바뀌어 폐기했다. */
  | { kind: 'geometry-changed' };

export interface UseSegmentRecorderResult {
  /** useLandmarker 의 onFrame 에 그대로 연결한다. 매 프레임 호출되며 리렌더를 일으키지 않는다. */
  onFrame: (snapshot: LandmarkSnapshot) => void;
  /** 캡처 버튼 press-in. 이미 기록 중이면 무시한다. */
  start: () => void;
  /** 캡처 버튼 press-out. 포스트롤 수집이 끝나면 결과를 resolve 한다. */
  stop: () => Promise<SegmentStopResult>;
  /** 기록 중 여부 — 버튼 시각 피드백용. */
  recording: boolean;
}

export function useSegmentRecorder(): UseSegmentRecorderResult {
  const [recording, setRecording] = useState(false);

  // 프레임 경로는 전부 ref 다. 매 프레임 setState 하면 검출 FPS 가 리렌더 비용에 오염된다.
  const preRollRef = useRef<LandmarkFrame[]>([]);
  const activeRef = useRef<ActiveRecording | null>(null);
  const pendingStopRef = useRef<PendingStop | null>(null);
  const lastSourceRef = useRef<CaptureSource | null>(null);

  const finalize = useCallback(() => {
    const active = activeRef.current;
    const pending = pendingStopRef.current;
    if (!active || !pending) return;

    clearTimeout(pending.timeoutId);
    activeRef.current = null;
    pendingStopRef.current = null;
    setRecording(false);

    // 좌표계가 도중에 바뀐 세그먼트는 보내지 않는다. capture 메타에는 W/H 를 한 벌만 실을 수
    // 있는데 프레임마다 좌표계가 다르면 어느 값을 실어도 절반은 틀린 AR 보정을 받게 된다.
    if (active.geometryChanged) {
      pending.resolve({ kind: 'geometry-changed' });
      return;
    }

    const source = lastSourceRef.current;
    if (active.frames.length === 0 || !source) {
      pending.resolve({ kind: 'empty' });
      return;
    }

    const segment: SignSegment = {
      frames: active.frames,
      press_start_ms: active.pressStartMs,
      press_end_ms: pending.pressEndMs,
      boundary_mode: 'manual',
      capture: {
        source_width: source.sourceWidth,
        source_height: source.sourceHeight,
        facing_mode: CAMERA_CONSTRAINTS_HINT.facingMode,
        preview_mirrored: PREVIEW_MIRRORED,
        delegate: source.delegate,
        landmarker_model_versions: LANDMARKER_MODEL_VERSIONS,
        client_version: CLIENT_VERSION,
      },
    };
    pending.resolve({ kind: 'segment', segment });
  }, []);

  const onFrame = useCallback(
    (snapshot: LandmarkSnapshot) => {
      const previous = lastSourceRef.current;
      lastSourceRef.current = {
        sourceWidth: snapshot.sourceWidth,
        sourceHeight: snapshot.sourceHeight,
        delegate: snapshot.delegate,
      };

      // 입력 해상도가 바뀌면 그 전후 프레임은 **서로 다른 좌표계**다.
      //
      // 정규화 좌표는 x 를 너비로, y 를 높이로 나눈 값이라 W/H 가 바뀌는 순간 같은 손 위치가
      // 다른 숫자가 된다. 서버는 세그먼트당 W/H 를 한 벌만 받아 x_scale = (W/H)/(16/9) 로 x 축
      // 전체를 보정하므로(preprocess_spoter.py), 섞인 세그먼트는 절반이 틀린 보정을 받는다.
      // 이 레포 기록상 x 스케일 오차 하나만으로 top-1 이 98.3% → 61.7% 로 무너진 적이 있다.
      //
      // 실기기 모바일 웹에서 이게 실제로 일어나는 경로는 **화면 방향 전환**이다(폰을 돌리면
      // videoWidth/Height 가 뒤바뀌는 브라우저가 있다). 카메라 재협상 등 다른 원인이어도
      // 대응은 같으므로 원인이 아니라 현상으로 판정한다.
      const geometryChanged =
        previous !== null &&
        (previous.sourceWidth !== snapshot.sourceWidth ||
          previous.sourceHeight !== snapshot.sourceHeight);

      const frame = toLandmarkFrame(snapshot);
      const active = activeRef.current;

      if (active) {
        // 여기서 녹화를 끊지 않는다 — 활성 녹화의 종료 트리거는 "손가락을 뗌" 하나라는 계약이
        // SignInputScreen 에 있다. 표시만 해 두고 finalize 에서 폐기한다.
        if (geometryChanged) active.geometryChanged = true;
        active.frames.push(frame);
        const pending = pendingStopRef.current;
        // 포스트롤은 프레임 타임스탬프 기준으로 끝낸다 (t_ms 와 press 시각은 같은 시계다).
        if (pending && frame.t_ms >= pending.pressEndMs + POST_ROLL_MS) finalize();
        return;
      }

      // 평상시: 프리롤 링 버퍼 유지.
      // 좌표계가 바뀌었으면 이전 좌표계의 프리롤은 버린다 — 안 버리면 방향을 바꾼 직후의
      // 첫 캡처가 시작부터 섞인 세그먼트가 되어 통째로 폐기된다.
      if (geometryChanged) preRollRef.current = [];
      const preRoll = preRollRef.current;
      preRoll.push(frame);
      while (preRoll.length > 0 && preRoll[0]!.t_ms < frame.t_ms - PRE_ROLL_MS) {
        preRoll.shift();
      }
    },
    [finalize],
  );

  const start = useCallback(() => {
    if (activeRef.current) return;
    // t_ms(= Math.round(performance.now()))와 같은 시계를 쓴다. Date.now() 를 섞지 말 것.
    const pressStartMs = Math.round(performance.now());
    activeRef.current = {
      pressStartMs,
      frames: [...preRollRef.current],
      geometryChanged: false,
    };
    preRollRef.current = [];
    setRecording(true);
  }, []);

  const stop = useCallback((): Promise<SegmentStopResult> => {
    if (!activeRef.current || pendingStopRef.current) return Promise.resolve({ kind: 'empty' });
    const pressEndMs = Math.round(performance.now());
    return new Promise<SegmentStopResult>((resolve) => {
      // 카메라가 프레임을 더 주지 않으면 t_ms 기준 종료가 영원히 안 온다. 벽시계 타임아웃으로
      // 그때까지 모인 프레임으로 마감한다(모인 프레임이 없으면 empty).
      const timeoutId = setTimeout(finalize, POST_ROLL_MS + POST_ROLL_TIMEOUT_GRACE_MS);
      pendingStopRef.current = { pressEndMs, resolve, timeoutId };
    });
  }, [finalize]);

  // 언마운트 시 대기 중인 stop() Promise 를 정리한다 — 화면 전환 후 콜백이 매달리지 않게.
  useEffect(() => {
    return () => {
      const pending = pendingStopRef.current;
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingStopRef.current = null;
        activeRef.current = null;
        pending.resolve({ kind: 'empty' });
      }
    };
  }, []);

  return { onFrame, start, stop, recording };
}
