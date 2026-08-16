/**
 * 손에 쥔 기기가 가로로 돌아갔는지 — 네이티브(기본) 구현.
 *
 * 네이티브 앱은 app.json 의 `"orientation": "portrait"` 로 세로 고정이라 가로가 될 수 없다.
 * ⚠️ 그 설정은 **네이티브 전용이며 모바일 웹에는 적용되지 않는다** — 실기기 브라우저는 폰을
 * 돌리면 그대로 가로가 된다. 웹 판정은 useHandheldLandscape.web.ts 에 있다.
 *
 * 번들러가 웹에서 .web.ts 를 대신 고른다(플랫폼별 확장자 해석).
 */
export function useHandheldLandscape(): boolean {
  return false;
}
