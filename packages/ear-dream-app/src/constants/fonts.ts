/**
 * 앱에 싣는 Noto Sans KR 서브셋 (네이티브 · 기본).
 *
 * 파일은 `pnpm setup:fonts` 가 만든다 — 원본(가중치당 6.19MB)에서 한자를 걷어내고
 * 한글 음절 전체만 남긴 것이다. 산출물이라 커밋하지 않는다(MediaPipe 애셋과 같은 방침).
 *
 * 웹은 fonts.web.ts 가 같은 서브셋의 **woff2** 를 쓴다 — 자체 압축이라 전송이 절반이지만
 * iOS/Android 는 woff2 를 못 읽으므로 여기(네이티브)는 ttf 다.
 */

export const fontAssets = {
  NotoSansKR_400Regular: require('../../assets/fonts/NotoSansKR_400Regular.ttf'),
  NotoSansKR_500Medium: require('../../assets/fonts/NotoSansKR_500Medium.ttf'),
  NotoSansKR_700Bold: require('../../assets/fonts/NotoSansKR_700Bold.ttf'),
};
