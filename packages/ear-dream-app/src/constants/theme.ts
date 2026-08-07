/**
 * 와이어프레임 단계 색 · 치수 토큰.
 *
 * 확정된 디자인(색 팔레트 · 폰트 · 아이콘)은 아직 없다. 회색조는 자리표시일 뿐이므로
 * 화면 코드에 색을 직접 적지 말고 반드시 이 파일을 거친다 — 디자인이 확정되면 여기만 바꾼다.
 */
export const colors = {
  background: '#FFFFFF',

  /** 카드 · pill 버튼 기본 면 */
  surface: '#EEEEEE',
  /** 카메라 · 영상 placeholder 같은 큰 영역 */
  surfaceStrong: '#D9D9D9',
  /** 선택된 카드/칩의 면 */
  surfaceSelected: '#CFCFCF',

  border: '#BDBDBD',
  /** 선택 상태 강조 테두리 */
  borderStrong: '#4A4A4A',

  textPrimary: '#111111',
  textSecondary: '#555555',
  textMuted: '#9A9A9A',

  /** 모달 · 예외 오버레이 뒤에 까는 어두운 막 */
  overlayScrim: 'rgba(0, 0, 0, 0.45)',
  overlayCard: '#FFFFFF',

  cameraBackground: '#000000',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** 한 손(엄지) 조작 기준 최소 터치 타겟. iOS 44pt / Android 48dp 이상. */
export const touchTarget = { minHeight: 48 } as const;

/**
 * 화면 콘텐츠 최대 폭. 피그마 시안이 세로 430pt 기준이라, 웹 브라우저에서
 * 와이어프레임이 가로로 퍼져 구도가 깨지지 않게 폰 폭 수준으로 제한한다.
 */
export const maxScreenWidth = 480;
