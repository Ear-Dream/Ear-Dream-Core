/**
 * 디자인 토큰 — 피그마 「UI v2 (MVP)」 변수 실측값 기반.
 *
 * 토큰 이름은 피그마 변수명(text/primary, bg/canvas ...)을 따른다.
 * 화면 코드에 색을 직접 적지 말고 반드시 이 파일을 거친다.
 *
 * 시안은 Light/Dark 양쪽 토큰을 정의하지만 현재는 Light 만 구현한다.
 * Dark 값이 확정되면 `darkTheme: ThemeColors` 를 추가하고 선택 로직을 붙인다.
 */
import { Platform, type TextStyle } from 'react-native';

export interface ThemeColors {
  text: {
    primary: string;
    /** 시트 제목처럼 한 단계 더 진한 제목용. 피그마 변수 `text/strong`. */
    strong: string;
    secondary: string;
    /** brand 면(인디고) 위 텍스트 */
    onBrand: string;
    /** brand 면 위 보조 텍스트(부제) — 흰색보다 한 단계 물러난 회색 */
    onBrandSubtle: string;
    /** brand 면 위 가장 약한 텍스트(캡션) */
    onBrandMuted: string;
    /** 다크 미디어 카드(뷰파인더/비디오) 위 텍스트 */
    onVideo: string;
  };
  bg: {
    canvas: string;
    surface: string;
    /**
     * 트랙 면 — 청인 입력 화면 전체와 첫 화면 상단이 서는 인디고 면.
     * `brand/primary` 를 캔버스 위에 74% 로 얹은 것과 같은 값이라 두 화면의 톤이 이어진다.
     */
    brandSurface: string;
    /** 단어 칩(pill) 바탕. 피그마 변수 `bg/chip`. */
    chip: string;
    /** 하단 시트 등 캔버스 위에 떠 있는 면. 피그마 변수 `bg/card`. */
    card: string;
    /**
     * 농인 입력 화면 하단의 단어 스트립 면(460:2764). 피그마 변수가 아니라 시안
     * 하드코드값이라 확정 변수가 나오면 여기만 교체한다.
     */
    wordStrip: string;
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
    /** 시트 손잡이 등 아주 약한 구분선. 피그마 변수 `line/soft`. */
    soft: string;
  };
  status: {
    success: string;
    /**
     * 다크 뷰파인더 위의 초록 (확정 디자인 `status/success-on-dark`).
     * `success`(#137a43)는 밝은 면 기준이라 bg/video 위에서는 거의 안 읽힌다.
     */
    successOnDark: string;
    /**
     * 촬영 대기 상태의 캡처 버튼(테두리 + 안쪽 원). 시안 애셋 `Stop`(467:846)의
     * 하드코드 값이라 피그마 변수가 아니다 — `success`(#137a43)보다 어둡다.
     * 녹화가 시작되면 `error` 로 바뀐다(색만으로 상태를 말하지 않게 모양도 함께 바뀐다).
     */
    recordReady: string;
    /**
     * 빨강 계열(녹화 중 배지 · 정지 버튼 · 인식 실패)은 피그마 변수 실측값이 없어
     * 시안 스크린샷 관측 근사값이다. 변수 값이 확인되면 여기만 교체한다.
     */
    error: string;
    /** 다크 뷰파인더 위의 빨강 (확정 디자인 「2-1. 인식 실패」 실측 하드코드값). */
    errorOnDark: string;
    /** 인식 실패 예외 카드의 연빨강 배경 */
    errorSubtle: string;
    /** 듣는 중 상태의 연빨강 링 등 중간 톤 */
    errorSoft: string;
  };
}

export const lightTheme: ThemeColors = {
  text: {
    primary: '#0b0f14',
    strong: '#17172b',
    secondary: '#3d4752',
    onBrand: '#ffffff',
    onBrandSubtle: '#cecece',
    onBrandMuted: '#afafaf',
    onVideo: '#ffffff',
  },
  bg: {
    canvas: '#ffffff',
    surface: '#f1f4f7',
    brandSurface: '#7d76ec',
    chip: '#efedfa',
    card: '#ffffff',
    wordStrip: '#d5d5fa',
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
    soft: '#e8e6f2',
  },
  status: {
    success: '#137a43',
    successOnDark: '#4ade80',
    recordReady: '#2b7646',
    error: '#dc2626',
    errorOnDark: '#c62828',
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
 * 한국어 큰 글자용 줄바꿈 규칙 — **어절 단위로만 끊는다**.
 *
 * 브라우저 기본값은 한글을 글자 단위로 끊어서, 큰 글자일수록 "반갑습 / 니다." 처럼
 * 한 단어가 두 줄에 걸린다. 시안의 줄바꿈(「안녕하세요, / 반갑습니다.」)은 어절 기준이라
 * 이걸 맞춰야 같은 그림이 된다. 읽기 난이도 문제이기도 하다 — 이 문장은 청인이 처음
 * 보는 문장이라 한 번에 읽혀야 한다.
 *
 * 웹 전용 CSS 라 RN 스타일 타입에 없다. 네이티브에서는 빈 객체가 되어 무시된다.
 */
export const koreanWordBreak = (
  Platform.OS === 'web' ? { wordBreak: 'keep-all' } : {}
) as TextStyle;

/**
 * 화면 콘텐츠 최대 폭. 피그마 시안이 세로 430pt 기준이라, 웹 브라우저에서
 * 구도가 가로로 퍼져 깨지지 않게 폰 폭 수준으로 제한한다.
 */
export const maxScreenWidth = 480;
