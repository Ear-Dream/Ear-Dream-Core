/**
 * 수어 세션의 클라이언트 로컬 상태 타입.
 *
 * `Message` 와 같은 관행이다(core/types.ts 참고): 서버가 저장/동기화하지 않는 순수 클라이언트
 * 상태라 앱에서 정의한다. 서버가 세션을 다루게 되면 Pydantic 스키마로 옮기고 생성 타입을 쓴다.
 * (어휘 ID·라벨 값 자체는 서버 응답 SignCandidate 에서 온 것을 그대로 담는다.)
 */

/**
 * 확정 단어 하나 — pill 큐 재구성(2026-08-10) 이후에는 저장 상태가 아니라 **파생값**이다:
 * SignFlow 가 done 큐 엔트리(useRecognitionQueue)의 현재 선택 후보에서 계산해
 * compose-sentence 입력과 ResultScreen 병기 표시에 쓴다.
 */
export interface SessionWord {
  /** 칩 식별자 (클라이언트 로컬 — 같은 단어를 두 번 넣어도 개별 삭제되게). */
  localId: string;
  /** 어휘 ID (SignCandidate.id, 예: "w_1510"). compose-sentence 의 word_ids 로 간다. */
  wordId: string;
  /** 표시용 단어 (SignCandidate.label). */
  label: string;
  /** 이 단어를 만든 /recognize request_id — compose-sentence 의 source_request_ids 추적용. */
  sourceRequestId: string;
}
