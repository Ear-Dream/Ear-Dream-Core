import type { QualityIssue } from '@ear-dream/core';

/**
 * 화면 문자열 모음 — 피그마 「UI v2 (MVP)」 시안 카피 기준.
 *
 * 시안에 있는 문구는 그대로 옮겼다. 시안에 프레임이 없어 앱에서 보충한 문구는
 * 주석으로 "시안 외 임시 카피" 라고 표시했다 — 확정 카피가 아니라는 뜻이다.
 */
export const strings = {
  common: {
    appName: 'Ear Dream',
    logoAlt: 'Ear Dream 로고',
    back: '뒤로 가기',
  },

  home: {
    startSign: '손으로 말하기',
    startVoice: '입으로 말하기',
    landmarkDev: '개발용: 랜드마크 확인 화면',
  },

  /**
   * 수어 입력 화면 — 방향 전환(단어 단위 인식 → 누적 → 문장) 반영.
   * 새 방향의 화면은 피그마 「검증 필요」 섹션에만 있고 확정 시안이 아니라서,
   * 아래 문구는 전부 시안 외 임시 카피다.
   */
  signInput: {
    appBarTitle: '수어 입력',
    recordingBadge: '기록 중',
    captureAlt: '단어 기록 버튼. 누르는 동안 수어 한 단어를 기록합니다',
    captureHint: '버튼을 누른 채 한 단어를 동작해 주세요',
    cameraLoading: '카메라 준비 중...',
    /**
     * 검출 상태 안내 — 비차단 문구다. "손이 밖에 있다가 들어오는" 게 정상 사용이라
     * 검출 안 됨은 실패가 아니고, 캡처는 검출 여부와 무관하게 항상 가능하다.
     * 손이 우선이다(인식의 실제 재료). 어깨는 어드바이저리 톤 — 서버도 이제
     * shoulders_not_visible 을 추론을 막지 않는 어드바이저리로 다룬다.
     */
    guideShouldersMissing: '상체가 화면에 들어오면 더 정확해요',
    guideHandsMissing: '손이 화면에 보이게 해주세요',
    guideAllVisible: '어깨와 손이 잘 보여요',
    /**
     * 인식 결과 인라인 안내 — rejected/low_quality 는 화면 전환 없이 입력 화면에 남아
     * 이 배너로만 알린다(흐름 유지 · 즉시 재시도 가능 · 추가 탭 0회). 에러가 아니므로
     * 빨강을 쓰지 않는다.
     */
    noticeRejected: '아직 배우지 못한 단어예요 — 다른 표현으로 다시 동작해 주세요',
    noticeLowQualityFallback: '동작이 잡히지 않았어요 — 손이 화면 안에 보이게 하고 다시 해주세요',
    /**
     * QualityIssue 별 인라인 안내. Partial 이 계약이다 — 서버가 enum 값을 추가해도
     * 앱 타입체크가 깨지지 않고 noticeLowQualityFallback 으로 표시된다.
     */
    noticeIssues: {
      no_hand_detected: '손이 화면에 잡히지 않았어요 — 손이 보이게 하고 다시 동작해 주세요',
      hand_out_of_frame: '손이 화면 밖으로 나갔어요 — 조금 물러나서 다시 동작해 주세요',
      hand_partially_out: '손이 화면에 다 들어오지 않았어요 — 조금 물러나서 다시 동작해 주세요',
      shoulders_not_visible: '상체가 화면에 들어오면 더 정확해요 — 다시 동작해 주세요',
      too_few_valid_frames: '동작이 너무 짧게 기록됐어요 — 버튼을 누른 채 조금 길게 동작해 주세요',
    } as Partial<Record<QualityIssue, string>>,
    /**
     * 전송 실패(인식 실패 아님) — 세그먼트가 보존되어 있고, 해당 pill(↻)을 탭하면
     * 그 단어만 재전송된다. 배너는 이유 안내만 담당한다(조작은 pill 몫).
     */
    sendFailedModel: '단어를 읽을 준비가 아직 안 됐어요 — 빨간 단어를 눌러 다시 보내주세요',
    sendFailedNetwork: '서버와 연결이 잘 안 됐어요 — 빨간 단어를 눌러 다시 보내주세요',
    sendFailedServer: '서버에서 문제가 생겼어요 — 빨간 단어를 눌러 다시 보내주세요',
    sendFailedTimeout: '서버 응답이 없어요 — 빨간 단어를 눌러 다시 보내주세요',
    /** stop() 이 빈 세그먼트를 돌려준 경우(카메라 정지 등) — 로컬 안내. */
    emptySegment: '카메라 화면이 잡히지 않았어요. 잠시 후 다시 눌러 주세요.',
    compose: '문장 만들기',
    /** "문장 만들기" 비활성 이유 — 대기/실패 pill 이 남아 있으면 만들 수 없다. */
    composeBlockedPending: '단어를 읽는 중이에요 — 끝나면 문장을 만들 수 있어요',
    composeBlockedFailed: '보내지 못한 단어가 있어요 — 다시 보내거나 지워주세요',
    /** 인식 큐 pill — 대기(…) / 확정(단어) / 실패(↻) 상태별 라벨과 스크린 리더 문구. */
    pillPendingLabel: '···',
    pillPendingA11y: '단어를 읽는 중 — 누르면 취소해요',
    pillFailedLabel: '재전송',
    pillFailedA11y: '보내지 못한 단어 — 누르면 다시 보내요',
    pillFailedRemoveA11y: '보내지 못한 단어 지우기',
    pillDoneA11ySuffix: '단어 — 누르면 다른 후보로 바꾸거나 지울 수 있어요',
    modelNotReady: '서버 모델이 아직 준비되지 않았어요. 기록은 할 수 있지만 인식이 실패할 수 있어요.',
  },

  recognizing: {
    /** 농인 트랙(수어 인식 중) — 시안 카피 그대로. */
    sign: {
      appBarTitle: '수어 인식 중',
      title: '수어 동작을 읽고 있어요',
      /** 시안 카피 그대로. "3초"는 실측값이 아니다 — 인식 파이프라인 미구현. */
      subtitle: '보통 3초 정도 걸려요',
      cancel: '취소하고 다시 찍기',
    },
    /**
     * 청인 트랙(음성 인식 중) — 시안에 청인용 인식 중 프레임이 없어 화면을 공용으로 쓰고
     * 문구만 컨텍스트에 맞게 바꾼 것이다. 시안 외 임시 카피.
     */
    voice: {
      appBarTitle: '음성 인식 중',
      title: '말씀하신 내용을 읽고 있어요',
      subtitle: '보통 3초 정도 걸려요',
      cancel: '취소하고 다시 말하기',
    },
  },

  /**
   * 단어 후보 하단 시트 — pill 큐 재구성(2026-08-10)으로 후보 "화면" 전환이 사라지고,
   * 확정 pill 탭 시 열리는 시트가 top-k 후보 교체·삭제를 담당한다. 시안 외 임시 카피.
   *
   * rejected/low_quality 는 시트로 오지 않는다 — 입력 화면의 인라인 배너
   * (signInput.notice*)가 담당한다. 시트는 recognized(확정) 전용이고, 어드바이저리
   * quality_issues 가 있으면 힌트 한 줄만 보탠다(흐름 방해 금지).
   */
  wordSheet: {
    prompt: '어떤 단어였는지 골라주세요.',
    removeWord: '이 단어 지우기',
    close: '닫기',
    /**
     * recognized + 어드바이저리 quality_issues 힌트. Partial 이 계약이다 — 서버 enum
     * 추가가 앱 타입체크를 깨지 않고, 없는 값은 advisoryFallback 으로 표시된다.
     */
    advisoryFallback: '다음엔 손과 상체가 화면에 잘 들어오면 더 정확해요',
    advisoryHints: {
      shoulders_not_visible: '다음엔 상체가 화면에 들어오면 더 정확해요',
      hand_partially_out: '다음엔 손이 화면 안에 다 들어오면 더 정확해요',
    } as Partial<Record<QualityIssue, string>>,
  },

  /**
   * 문장 결과 화면 — 조립한 단어 열 + /compose-sentence 결과. 시안 외 임시 카피.
   * 청인이 보는 화면이므로 문장은 큰 글자 · 고대비.
   */
  result: {
    appBarTitle: '음성 전달',
    speakerAlt: '음성 재생 (TTS 미구현 — 표시만 한다)',
    caption: '상대방에게 음성으로 전달되고 있어요',
    composing: '문장을 만들고 있어요',
    /** source=word_list — 규칙/모델이 문장으로 다듬지 못하고 단어를 그대로 나열한 경우. */
    wordListNotice: '문장으로 다듬지 못해 단어를 그대로 나열했어요',
    inputWordsLabel: '입력한 단어',
    alternativesLabel: '다른 문장',
    composeFailedTitle: '문장을 만들지 못했어요',
    composeFailedBody: '입력한 단어는 그대로 있어요. 연결을 확인한 뒤 다시 보내주세요.',
    retryCompose: '다시 보내기',
    backToStart: '처음으로 돌아가기',
  },

  voiceInput: {
    appBarTitle: '음성 입력',
    title: '말씀해 주세요',
    subtitle: '수어 영상으로 바꿔서 보여드릴게요',
    micAlt: '음성 입력 시작 (마이크는 미구현, 탭하면 듣는 중 상태로 전환)',
    stopAlt: '듣기 정지',
    listeningBadge: '듣고 있어요',
    noiseCaption: '주변 소음이 크다면 키보드로 입력해주세요.',
    keyboardFallback: '키보드로 입력하기',
    textPlaceholder: '전달할 내용을 입력하세요',
    textConfirm: '확인',
    /**
     * 10초(임시값, mock.ts) 안에 인식하지 못했을 때의 알림 — 시안 주석
     * ("인식하지 못하면 다시 해달라는 알림창")을 옮긴 것으로, 문구 자체는 시안 외 임시 카피.
     */
    timeoutTitle: '음성을 인식하지 못했어요',
    timeoutBody: '다시 한 번 말씀해 주세요',
    timeoutConfirm: '확인',
  },

  signVideo: {
    appBarTitle: '수어로 보기',
    playingBadge: '재생 중',
    caption: '인식한 수어 동작을 다시 재생하고 있어요',
    avatarAlt: '수어 영상 자리 (영상 미구현)',
    /** 시안에 없는 소스 영역 라벨 — 사용자 확정 범위에 따라 추가. 시안 외 임시 카피. */
    sourceLabel: '상대방이 말한 내용',
    speedLabel: '재생 속도',
    replay: '다시 보기',
  },
} as const;
