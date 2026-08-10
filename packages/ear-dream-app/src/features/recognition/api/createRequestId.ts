/**
 * 요청/세션 식별자 생성.
 *
 * 웹(보안 컨텍스트)에서는 `crypto.randomUUID()` 를 쓴다. 그 외 환경(구형 브라우저,
 * Expo Go 의 일부 런타임)을 위한 폴백은 Math.random 기반 v4 형태 근사다 — 암호학적
 * 난수가 아니지만 이 식별자의 용도는 멱등·추적(서버 로그 대조)이라 충돌 확률만 충분히
 * 낮으면 된다.
 */
export function createRequestId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
