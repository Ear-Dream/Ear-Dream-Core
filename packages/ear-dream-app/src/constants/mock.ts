/**
 * 흐름 시뮬레이션용 임시값 · 목업 데이터.
 *
 * 여기 있는 값은 전부 미확정이다. 인식 파이프라인(T-08 이후)이 붙으면
 * 이 파일의 값은 그 값을 쓰는 코드와 함께 제거하거나 실제 값으로 대체한다.
 */

/**
 * "인식 중" 화면 체류 시간(ms). 실제 추론 지연이 아니라 화면 전환 타이머다.
 * 설계 문서의 허용 지연 목표치(미확정)와 아무 관련이 없다.
 * 시안 카피 "보통 3초 정도 걸려요" 역시 실측 근거가 아니다.
 */
export const MOCK_RECOGNITION_DELAY_MS = 2500;

/**
 * 후보 단어 목업.
 *
 * 인식 결과가 문장에서 단어로 바뀌면서(단어를 골라 문장을 조합하는 흐름) 후보도 단어가 됐다.
 * 값은 V2 시안 "단어 선택" 프레임의 후보 4개(교통수단)를 그대로 옮긴 것이다.
 *
 * 후보 개수 N 은 사용자 검증 전까지 미확정이다 — 4가 확정값이라는 뜻이 아니라
 * 시안이 2×2 그리드라 4개일 뿐이다.
 */
export interface MockCandidateWord {
  /**
   * 어휘 ID. 표시어(word)만으로는 동음이의어를 구분할 수 없고, 확정 로그에 ID 가 남지 않으면
   * 나중에 오인식률을 되짚을 수 없다. 실제 어휘 집합(T-04)이 정해지면 그 ID 로 대체한다.
   */
  id: string;
  /** 화면에 보이는 표시어. */
  word: string;
  /** `CANDIDATE_ICONS` 의 키. 없으면 카드에 글자만 나온다. */
  iconKey?: string;
}

export const MOCK_CANDIDATE_WORDS: readonly MockCandidateWord[] = [
  { id: 'w-car', word: '자동차', iconKey: 'car' },
  { id: 'w-subway', word: '지하철', iconKey: 'subway' },
  { id: 'w-bus', word: '버스', iconKey: 'bus' },
  { id: 'w-train', word: '기차', iconKey: 'train' },
];

/**
 * 고른 단어들을 전달 문장으로 합친다.
 *
 * 실제 문장 생성(조사·어미 붙이기, 어순 정리)은 미구현이다. 지금은 고른 순서대로 띄어
 * 이어 붙이기만 하므로 "자동차 지하철" 같은 단어 나열로 보이는 게 정상이고, 그게 아직
 * mock 이라는 표시다. 그럴듯한 문장으로 보이게 손대면 완성된 기능처럼 오해된다.
 *
 * 서버 문장 생성이 붙으면 이 함수를 그 호출로 대체한다.
 */
export function composeMockSentence(words: readonly MockCandidateWord[]): string {
  return words.map((candidate) => candidate.word).join(' ');
}

/**
 * 청인 트랙 "수어로 보기" 화면의 인식 문장 목업 (피그마 시안 예시 문장 그대로).
 * STT 미구현이라 음성/키보드 입력과 무관하게 이 문장을 표시한다.
 */
export const MOCK_RECOGNIZED_SPEECH = '안녕하세요, 반갑습니다.';

/**
 * 손이 계속 안 보일 때 인식 실패 상태("손이 잘 안 보였어요")로 전환하기까지의 지연(ms).
 * 검증되지 않은 프로토타입 임시값 — 한두 프레임 검출 누락에 화면이 깜빡이는 것만 막는 용도다.
 *
 * 시안 프레임명은 "3번 인식 실패 예외"지만, 3회 실패 카운트는 인식이 미구현이라 만들 수 없다.
 * 그때까지는 손 미검출 지속을 mock 트리거로 쓴다.
 */
export const HAND_LOST_OVERLAY_DELAY_MS = 1200;

/**
 * 음성 입력 "듣는 중" 상태의 타임아웃(ms). 시안 주석 "음성 인식 시간(10초 이내)로 인식하지
 * 못하면 다시 해달라는 알림창" 을 옮긴 프로토타입 임시값 — 10초가 확정값이라는 뜻이 아니다.
 */
export const VOICE_LISTEN_TIMEOUT_MS = 10_000;