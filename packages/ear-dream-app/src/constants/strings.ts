/**
 * 화면 문자열 모음.
 *
 * 괄호로 감싼 문자열(예: "(말하라는 메세지)")은 피그마 시안의 placeholder 를 그대로 옮긴 것이다 —
 * 실제 문구는 미확정이라는 뜻이므로 임의로 그럴듯한 카피를 채워 넣지 않았다.
 * 나머지 문구도 와이어프레임 단계 임시 카피이며 확정 카피가 아니다.
 */
export const strings = {
  common: {
    appName: 'Ear Dream',
    /** 로고(구름+달) 아이콘 확정 전 placeholder 글리프 */
    logoGlyph: '☁︎',
    logoAlt: 'Ear Dream 로고',
    backToHome: '처음으로',
    recognizing: '인식 중 ...',
  },

  home: {
    startSign: '수어로 시작하기',
    startVoice: '구어로 시작하기',
    /** 동작 미정(피그마에 연한 스타일로만 존재) — placeholder 버튼 */
    startTrial: '또는 체험으로 시작하기',
    landmarkDev: '개발용: 랜드마크 확인 화면',
  },

  signInput: {
    startTranslate: '번역 시작',
    cameraLoading: '카메라 준비 중...',
    handLostTitle: '손이 안 보여요',
    /** 피그마 placeholder 그대로 — 안내 문구 미확정 */
    handLostBody: '(인식하지 못했음을 알려주는 메세지)',
    /** 피그마 placeholder 그대로 — 재입력 유도 문구 미확정 */
    reinputMessage: '(재입력을 유도하는 메세지)',
  },

  candidates: {
    confirm: '문장 선택 완료',
    /** 정정 진입점. 임시 문구 — 확정 카피 아님 */
    notFound: '찾는 문장이 없어요 (정정)',
  },

  correction: {
    title: '이 문장이 맞나요?',
    retry: '다시 입력',
    manual: '직접 입력',
    /** 직접 입력 모드 임시 문구 */
    manualPlaceholder: '전달할 문장을 입력하세요',
    manualConfirm: '입력 완료',
    close: '닫기',
  },

  result: {
    /** 피그마 시안 문구. 실제 TTS 는 미구현이며 표시만 한다 */
    playing: '음성 재생 중...',
    speakerGlyph: '🔊',
    speakerAlt: '음성 재생 (미구현)',
    retranslate: '다시 번역',
  },

  voiceInput: {
    micGlyph: '🎤',
    micAlt: '음성 입력 시작 (마이크는 미구현, 탭하면 흐름만 진행)',
    /** 피그마 placeholder 그대로 — 발화 유도 문구 미확정 */
    speakPrompt: '(말하라는 메세지)',
    textFallback: '텍스트 입력',
    textPlaceholder: '전달할 내용을 입력하세요',
    textConfirm: '확인',
  },

  signVideo: {
    /** 영상 placeholder 영역 설명 (피그마 문구) */
    videoPlaceholder: '청인의 음성을 인식한 수어 영상',
    /** 피그마의 하단 텍스트 자리 placeholder — 인식된 문장이 표시될 자리 */
    textSlot: '텍스트',
    speakAgain: '다시 말하기',
  },

  composer: {
    title: '자유 발화',
    subtitle: '수어 동작과 문장을 함께 확인해요',
    /** 상단 우측 + 버튼 — 동작 미정 placeholder */
    addSymbol: '+',
    motionCaption: '지금 선택한 단어',
    motionCaptionEmpty: '단어를 선택하세요',
    motionTitle: '지금 동작 미리 보기',
    nextWords: '다음 단어 추천',
    speed: '동작 재생 속도',
    speak: '말하기',
    add: '추가',
    /** 조합 결과 표시 줄. 피그마에는 없지만 흐름 확인용으로 둔 와이어프레임 보조 요소 */
    composedLabel: '조합한 문장',
    composedEmpty: '추가한 단어가 여기에 표시됩니다',
  },
} as const;
