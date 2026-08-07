/**
 * 마이크 레벨 (파형 표시용).
 *
 * 쓰는 쪽은 이 배럴만 보면 된다. 플랫폼별 구현(.web / 네이티브)은 번들러가 고른다.
 *
 *   const { amplitudes, status } = useMicLevels(listening, WAVEFORM_BAR_COUNT);
 *   <Waveform amplitudes={amplitudes} />
 *
 * 레벨 표시 전용이다 — 음성 인식(STT)과는 무관하고, 오디오를 저장하거나 전송하지 않는다.
 */
export { useMicLevels } from './useMicLevels';
export type { MicLevelStatus, UseMicLevelsResult } from './types';
