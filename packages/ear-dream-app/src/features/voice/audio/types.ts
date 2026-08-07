import type { Animated } from 'react-native';

/**
 * 마이크 레벨 훅의 플랫폼 중립 계약.
 *
 * 구현이 웹 Web Audio 든 네이티브 모듈이든 화면 코드는 이 형태만 본다.
 */
export type MicLevelStatus =
  /** 아직 요청하지 않음(듣는 중이 아님). 진폭은 0 — 파형은 일자선. */
  | 'idle'
  /** 마이크 권한/스트림 요청 중. */
  | 'requesting'
  /** 레벨을 읽고 있음. */
  | 'listening'
  /** 사용자가 마이크 권한을 거부함. */
  | 'denied'
  /** 이 플랫폼에서 마이크 레벨을 읽을 수 없음. */
  | 'unsupported'
  /** 그 밖의 실패(장치 없음 등). */
  | 'error';

export interface UseMicLevelsResult {
  /**
   * 막대별 진폭 `Animated.Value` (0 = 무음, 1 = 최대). 배열 자체는 훅 수명 동안 유지되고
   * 값만 프레임마다 갱신된다 — 리렌더를 유발하지 않는다.
   */
  amplitudes: Animated.Value[];
  status: MicLevelStatus;
  /** 사용자에게 보여줄 실패 사유. 실패가 아니면 null. */
  error: string | null;
}
