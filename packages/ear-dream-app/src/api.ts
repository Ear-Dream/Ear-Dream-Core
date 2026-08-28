import { createApiClient } from "@ear-dream/core";

/**
 * 서버 주소 — 런타임 주입 > 빌드 시 주입 > 로컬 개발 기본값.
 *
 * **런타임 주입이 앞에 있는 이유는 WebView 셸(APK) 때문이다.** 셸은 이 웹 번들을 앱 안에
 * 담아 `https://appassets.androidplatform.net` 이라는 가상 오리진에서 연다. 그 오리진에는
 * API 가 없으므로 `serve-mobile` 의 단일 오리진 전제(상대경로 `/api`)가 성립하지 않고,
 * 절대 주소가 필요하다. 그런데 그 주소는 터널 세션마다 바뀐다 — 번들에 구워 넣으면
 * 주소가 바뀔 때마다 APK 를 다시 만들어야 한다. 그래서 셸이 index.html 을 내보내기
 * 직전에 이 전역을 채운다(`packages/android-shell` 의 WebAssetPathHandler).
 *
 * 셸이 없는 환경(브라우저)에서는 이 전역이 없으므로 아래 두 단계가 그대로 쓰인다 —
 * 웹 동작은 달라지지 않는다.
 *
 * ⚠️ `?? ` 를 쓰는 것이지 `||` 가 아니다. `pnpm build:web-mobile` 은
 * `EXPO_PUBLIC_API_URL=` 로 **빈 문자열**을 넣어 상대경로(단일 오리진)를 만든다 —
 * 빈 문자열은 폴백 대상이 아니라 의도된 값이다.
 */
function resolveBaseUrl(): string {
  const injected = (globalThis as { __EAR_DREAM_API_URL__?: unknown })
    .__EAR_DREAM_API_URL__;
  if (typeof injected === "string" && injected.length > 0) {
    // 끝의 `/` 를 남기면 경로가 `//api/v1/...` 이 된다.
    return injected.replace(/\/+$/, "");
  }
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
}

export const api = createApiClient(resolveBaseUrl());
