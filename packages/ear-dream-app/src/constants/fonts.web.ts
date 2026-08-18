/**
 * 앱에 싣는 Noto Sans KR 서브셋 (웹).
 *
 * ttf 대신 woff2 다 — 같은 서브셋인데 자체 압축(brotli)이라 전송이 절반이다
 * (가중치당 0.84MB → 0.52MB). 브라우저만 읽을 수 있으므로 네이티브는 fonts.ts 를 쓴다.
 */

export const fontAssets = {
  NotoSansKR_400Regular: require('../../assets/fonts/NotoSansKR_400Regular.woff2'),
  NotoSansKR_500Medium: require('../../assets/fonts/NotoSansKR_500Medium.woff2'),
  NotoSansKR_700Bold: require('../../assets/fonts/NotoSansKR_700Bold.woff2'),
};
