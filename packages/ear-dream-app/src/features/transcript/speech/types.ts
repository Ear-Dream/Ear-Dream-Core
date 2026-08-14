/**
 * 음성 출력(TTS) 훅의 플랫폼 중립 계약.
 *
 * 구현이 서버 TTS 든 브라우저 SpeechSynthesis 든 네이티브 모듈이든 화면 코드는 이 형태만 본다.
 */
import type { SentenceEmotion, SentenceStyle } from '@ear-dream/core';

/**
 * 문장에 실린 감정·말투. `/compose-sentence` 응답 candidate 의 태그를 **그대로** 넘긴다.
 *
 * 규칙 폴백으로 만들어진 문장은 태그가 null 이다 — 그때는 넘기지 않아도 되고,
 * 서버가 기본값(neutral/normal)으로 읽는다.
 */
export interface SpeechTags {
  emotion?: SentenceEmotion | null;
  style?: SentenceStyle | null;
}

export type SpeechStatus =
  /** 대기. 아직 말하지 않았거나 다 말했다. */
  | 'idle'
  /** 서버에 음성을 요청해 두고 기다리는 중. 아직 소리는 나지 않는다. */
  | 'loading'
  /** 말하는 중. */
  | 'speaking'
  /** 이 플랫폼에서 음성 출력을 쓸 수 없다. */
  | 'unsupported'
  /** 서버·브라우저 어느 쪽으로도 소리를 내지 못했다. */
  | 'error';

/** 어느 경로로 소리가 났는지. 아직 재생 전이면 null. */
export type SpeechEngine =
  /** 서버 TTS(`POST /api/v1/speech`) 가 만든 음성. 감정·말투가 반영된다. */
  | 'server'
  /** 브라우저 기본 음성 합성. 서버 TTS 를 쓸 수 없을 때의 정상 폴백이다. */
  | 'browser';

export interface UseSpeechResult {
  status: SpeechStatus;
  engine: SpeechEngine | null;
  /** 문장을 (다시) 읽는다. 말하는 중이면 처음부터 다시 읽는다. */
  speak: () => void;
  stop: () => void;
  /** 사용자에게 보여줄 실패 사유. 실패가 아니면 null. */
  error: string | null;
}
