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

  signInput: {
    appBarTitle: '수어 입력',
    recordingBadge: '녹화 중',
    /** 손 검출 상태와 연동해 표시한다(두 손 검출 시). */
    handsVisible: '두 손이\n잘 보여요',
    stopAlt: '촬영 정지',
    cameraLoading: '카메라 준비 중...',
    failBadge: '인식 실패',
    failTitle: '손이 잘 안 보였어요',
    retake: '다시 촬영하기',
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

  candidates: {
    appBarTitle: '인식 결과',
    prompt: '전달하고 싶은 문장을 선택해주세요.',
    confirm: '문장 선택 완료',
  },

  result: {
    appBarTitle: '음성 전달',
    speakerAlt: '음성 재생 (TTS 미구현 — 표시만 한다)',
    caption: '상대방에게 음성으로 전달되고 있어요',
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
