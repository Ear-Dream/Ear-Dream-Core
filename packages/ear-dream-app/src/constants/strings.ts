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
   * 시안 카피가 있는 항목(녹화 배지 · 단어 스트립)은 그대로 옮겼고,
   * pill 큐 · 인라인 안내 등 새 방향의 문구는 시안 외 임시 카피다.
   */
  signInput: {
    appBarTitle: '수어 입력',
    recordingBadge: '녹화 중',
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
    guideAllVisible: '어깨와 손이\n잘 보여요',
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
    /**
     * 기록 도중 화면 방향이 바뀌어 세그먼트를 폐기한 경우 — 로컬 안내. 시안 외 임시 카피.
     * 사용자가 할 일은 "세로로 되돌리고 다시 누르기" 하나이므로 그것만 말한다.
     */
    geometryChanged: '기록 중 화면 방향이 바뀌었어요. 세로로 들고 다시 눌러 주세요.',
    /**
     * 가로 화면 안내(모바일 웹 전용) — 시안 외 임시 카피.
     * 텍스트에만 의존하지 않게 회전 아이콘을 함께 띄운다(접근성 규칙).
     */
    landscapeTitle: '폰을 세로로 들어 주세요',
    landscapeBody: '수어 인식은 세로 화면 기준이에요',
    /** 하단 단어 스트립(시안 카피) — 인식한 단어 pill 이 쌓이는 자리. */
    wordsEmpty: '기록한 단어가 여기에 쌓여요',
    /** 스트립 오른쪽 완료 버튼 — 문장을 만들어 결과 화면으로 (시안 카피 "결과 확인"). */
    compose: '결과 확인',
    /** "결과 확인" 비활성 이유 — 대기/실패 pill 이 남아 있으면 문장을 만들 수 없다. */
    composeBlockedPending: '단어를 읽는 중이에요 — 끝나면 결과를 볼 수 있어요',
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
   * 확정 pill 탭 시 열리는 시트가 top-k 후보 교체·삭제를 담당한다.
   * prompt 는 V2 시안 "단어 선택" 카피, 나머지는 시안 외 임시 카피.
   *
   * rejected/low_quality 는 시트로 오지 않는다 — 입력 화면의 인라인 배너
   * (signInput.notice*)가 담당한다. 시트는 recognized(확정) 전용이고, 어드바이저리
   * quality_issues 가 있으면 힌트 한 줄만 보탠다(흐름 방해 금지).
   */
  wordSheet: {
    prompt: '단어를 선택해주세요',
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
   * 문장 결과 화면 — 조립한 단어 열 + /compose-sentence 결과.
   * 스피커·재생 문구는 V2 시안 "음성 전달" 기준, 연동 상태 문구는 시안 외 임시 카피.
   * 청인이 보는 화면이므로 문장은 큰 글자 · 고대비.
   */
  result: {
    appBarTitle: '음성 전달',
    speakerAlt: '음성 재생',
    caption: '상대방에게 음성으로 전달되고 있어요',
    /**
     * 재생 중 표시. 폰을 든 사람은 소리를 듣지 못하므로 음성이 나가는 중이라는 사실은
     * 반드시 눈으로도 보여야 한다. 시안 외 임시 카피.
     */
    speaking: '지금 말하고 있어요',
    /**
     * 하단 버튼이 "답장하기"로 바뀌면서 이 문구는 스피커 버튼의 스크린리더 라벨로 옮겨
     * 살렸다 — 한 번이라도 들려준 뒤에는 그 버튼이 하는 일이 "재생"이 아니라 "다시 듣기"다.
     */
    replay: '다시 듣기',
    /** 재생 중 스피커 버튼 — 누르면 멈춘다(도형도 정지 사각형으로 바뀐다). 시안 외 임시 카피. */
    speakerStopAlt: '음성 정지',
    /**
     * 서버 TTS 준비 중. 요청당 수 초가 걸려서, 누르고 아무 반응이 없으면 고장으로 보인다 —
     * 회전 링(재생 중 물결과 구분되는 모양)과 함께 이 문구를 반드시 보여준다.
     * 스피커 버튼 라벨과 카드 캡션에 같이 쓴다. 시안 외 임시 카피.
     */
    preparing: '음성을 준비하고 있어요',
    /** 한 번 재생된 뒤의 캡션 — 스피커가 눌린다는 사실을 알려준다. 시안 외 임시 카피. */
    tapToReplay: '스피커를 누르면 다시 들려줘요',
    /** 하단 버튼 — 청인 트랙(음성 입력)으로 넘어간다. 시안 외 임시 카피. */
    reply: '답장하기',
    /** 음성 합성을 쓸 수 없는 환경(현재 네이티브) 안내 — 시안 외 임시 카피. */
    speechUnavailable: '이 환경에서는 소리가 나오지 않아요. 화면의 문장을 보여주세요.',
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
    micAlt: '음성 입력 시작',
    stopAlt: '듣기 정지',
    listeningBadge: '듣고 있어요',
    noiseCaption: '주변 소음이 크다면 키보드로 입력해주세요.',
    /**
     * 마이크를 열지 못했을 때 noiseCaption 대신 보여주는 안내 — 시안 외 임시 카피.
     * 파형이 계속 일자로만 있는 이유를 알려주고 키보드 폴백으로 유도한다.
     */
    micUnavailableCaption: '마이크를 쓸 수 없습니다. 키보드로 입력해주세요.',
    /** 인식된 말이 아직 없을 때 자리를 지키는 안내 — 시안 외 임시 카피. */
    transcriptHint: '말씀하신 내용이 여기에 보여요',
    keyboardFallback: '키보드로 입력하기',
    textPlaceholder: '전달할 내용을 입력하세요',
    textConfirm: '확인',
    /**
     * 한 마디도 알아듣지 못한 채 세션이 끝났을 때의 알림 — 시안 주석
     * ("인식하지 못하면 다시 해달라는 알림창")을 옮긴 것으로, 문구 자체는 시안 외 임시 카피.
     * 대기 시간은 features/voice/stt/config.ts 의 STT_NO_SPEECH_TIMEOUT_MS(임시값).
     */
    timeoutTitle: '음성을 인식하지 못했어요',
    timeoutBody: '다시 한 번 말씀해 주세요',
    timeoutConfirm: '확인',
    /**
     * 음성 인식(STT) 상태 안내 — 전부 시안 외 임시 카피.
     *
     * 공통 원칙: **막다른 길을 만들지 않는다.** 음성이 안 되는 이유가 무엇이든 마지막 문장은
     * 항상 "키보드로 입력해주세요"다 — 키보드가 유일하게 남는 경로이기 때문이다.
     */
    stt: {
      /** 이 브라우저에 음성 인식 엔진이 없다(iOS 계열 등). 고장이 아니라 정상 경로다. */
      unsupported: '이 기기에서는 음성 인식을 쓸 수 없어요. 키보드로 입력해주세요.',
      /** 네이티브(Expo Go) — 웹에서만 동작한다는 사실을 그대로 알린다. */
      unsupportedNative: '음성 인식은 현재 웹에서만 동작해요. 키보드로 입력해주세요.',
      /**
       * http 로 열었을 때. 카메라(useLandmarker.web.ts)와 같은 제약·같은 해법이라 안내도
       * 같은 형태로 맞췄다 — 폰 사용자에게 "localhost 로 접속하라"만 말하면 할 수 있는 일이 없다.
       */
      insecureContext:
        '음성 인식은 보안 컨텍스트(https)에서만 열려요. 폰에서 보고 있다면 `pnpm serve:mobile` 이 띄운 https 주소로, PC 라면 localhost 주소로 여세요.',
      denied: '마이크 권한이 거부됐어요. 브라우저 권한을 허용하거나 키보드로 입력해주세요.',
      noMicrophone: '사용할 수 있는 마이크를 찾지 못했어요. 키보드로 입력해주세요.',
      network: '음성 인식 서비스에 연결하지 못했어요. 키보드로 입력해주세요.',
      failed: '음성 인식에 문제가 생겼어요. 키보드로 입력해주세요.',
    },
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
