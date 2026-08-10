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
}

interface PendingStop {
  pressEndMs: number;
  resolve: (segment: SignSegment | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export interface UseSegmentRecorderResult {
  /** useLandmarker 의 onFrame 에 그대로 연결한다. 매 프레임 호출되며 리렌더를 일으키지 않는다. */
  onFrame: (snapshot: LandmarkSnapshot) => void;
  /** 캡처 버튼 press-in. 이미 기록 중이면 무시한다. */
  start: () => void;
  /**
   * 캡처 버튼 press-out. 포스트롤 수집이 끝나면 SignSegment 로 resolve 한다.
   * 기록 중이 아니었거나 프레임이 전혀 없으면(카메라 정지 등) null.
   */
  stop: () => Promise<SignSegment | null>;
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

    const source = lastSourceRef.current;
    if (active.frames.length === 0 || !source) {
      pending.resolve(null);
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
    pending.resolve(segment);
  }, []);

  const onFrame = useCallback(
    (snapshot: LandmarkSnapshot) => {
      lastSourceRef.current = {
        sourceWidth: snapshot.sourceWidth,
        sourceHeight: snapshot.sourceHeight,
        delegate: snapshot.delegate,
      };

      const frame = toLandmarkFrame(snapshot);
      const active = activeRef.current;

      if (active) {
        active.frames.push(frame);
        const pending = pendingStopRef.current;
        // 포스트롤은 프레임 타임스탬프 기준으로 끝낸다 (t_ms 와 press 시각은 같은 시계다).
        if (pending && frame.t_ms >= pending.pressEndMs + POST_ROLL_MS) finalize();
        return;
      }

      // 평상시: 프리롤 링 버퍼 유지.
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
    activeRef.current = { pressStartMs, frames: [...preRollRef.current] };
    preRollRef.current = [];
    setRecording(true);
  }, []);

  const stop = useCallback((): Promise<SignSegment | null> => {
    if (!activeRef.current || pendingStopRef.current) return Promise.resolve(null);
    const pressEndMs = Math.round(performance.now());
    return new Promise<SignSegment | null>((resolve) => {
      // 카메라가 프레임을 더 주지 않으면 t_ms 기준 종료가 영원히 안 온다. 벽시계 타임아웃으로
      // 그때까지 모인 프레임으로 마감한다(빈 세그먼트면 null).
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
        pending.resolve(null);
      }
    };
  }, []);

  return { onFrame, start, stop, recording };
}
