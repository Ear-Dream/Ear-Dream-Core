/**
 * 수어 아바타 재생 — 청인 문장을 단어 스켈레톤으로 보여준다.
 *
 * 쓰는 쪽은 이 배럴만 본다. 좌표가 빌트인 자산에서 오는지 서버에서 오는지,
 * 어떻게 디코딩하는지는 화면이 알 필요가 없다.
 */
export { SkeletonPlayer } from './SkeletonPlayer';
export type { SkeletonPlayerProps } from './SkeletonPlayer';
export { useSignSequence } from './useSignSequence';
export type { SignSequencePhase, UseSignSequenceResult } from './useSignSequence';
export type { SignSequence } from './sequenceAssets';
