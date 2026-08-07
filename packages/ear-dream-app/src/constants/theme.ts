/**
 * 디자인 토큰 — 피그마 「UI v2 (MVP)」 변수 실측값 기반.
 *
 * 토큰 이름은 피그마 변수명(text/primary, bg/canvas ...)을 따른다.
 * 화면 코드에 색을 직접 적지 말고 반드시 이 파일을 거친다.
 *
 * 시안은 Light/Dark 양쪽 토큰을 정의하지만 현재는 Light 만 구현한다.
 * Dark 값이 확정되면 `darkTheme: ThemeColors` 를 추가하고 선택 로직을 붙인다.
 */
export interface ThemeColors {
  text: {
    primary: string;
    secondary: string;
    /** brand 면(인디고) 위 텍스트 */
    onBrand: string;
    /** 다크 미디어 카드(뷰파인더/비디오) 위 텍스트 */
    onVideo: string;
  };
  bg: {
    canvas: string;
    surface: string;
    /** 다크 미디어 카드(뷰파인더/비디오) 면 */
    video: string;
    /** 스크림 · 로고 등 가장 어두운 면 */
    overlay: string;
  };
  brand: {
    primary: string;
    accent: string;
    subtle: string;
  };
  border: {
    default: string;
  };
  status: {
    success: string;
    /**
     * 빨강 계열(녹화 중 배지 · 정지 버튼 · 인식 실패)은 피그마 변수 실측값이 없어
     * 시안 스크린샷 관측 근사값이다. 변수 값이 확인되면 여기만 교체한다.
     */
    error: string;
    /** 인식 실패 예외 카드의 연빨강 배경 */
    errorSubtle: string;
    /** 듣는 중 상태의 연빨강 링 등 중간 톤 */
    errorSoft: string;
  };
}

export const lightTheme: ThemeColors = {
  text: {
    primary: '#0b0f14',
    secondary: '#3d4752',
    onBrand: '#ffffff',
    onVideo: '#ffffff',
  },
  bg: {
    canvas: '#ffffff',
    surface: '#f1f4f7',
    video: '#111820',
    overlay: '#0b0f14',
  },
  brand: {
    primary: '#4f46e5',
    accent: '#4f46e5',
    subtle: '#eef0fe',
  },
  border: {
    default: '#b9c2cb',
  },
  status: {
    success: '#137a43',
    error: '#dc2626',
    errorSubtle: '#fdeeed',
    errorSoft: '#f2b8b5',
  },
};

/** 현재 앱이 쓰는 테마. Light 만 구현되어 있다. */
export const colors: ThemeColors = lightTheme;

/**
 * Noto Sans KR (피그마 지정 서체). expo-font 로 앱에 번들해 로드한다(App.tsx).
 * 커스텀 폰트는 fontWeight 로 굵기가 갈리지 않으므로(특히 Android),
 * 굵기별 family 이름을 쓰고 스타일에서 fontWeight 를 함께 지정하지 않는다.
 */
export const fonts = {
  regular: 'NotoSansKR_400Regular',
  medium: 'NotoSansKR_500Medium',
  bold: 'NotoSansKR_700Bold',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** 한 손(엄지) 조작 기준 최소 터치 타겟. iOS 44pt / Android 48dp 이상. */
export const touchTarget = { minHeight: 48 } as const;

/**
 * 화면 콘텐츠 최대 폭. 피그마 시안이 세로 430pt 기준이라, 웹 브라우저에서
 * 구도가 가로로 퍼져 깨지지 않게 폰 폭 수준으로 제한한다.
 */
export const maxScreenWidth = 480;
