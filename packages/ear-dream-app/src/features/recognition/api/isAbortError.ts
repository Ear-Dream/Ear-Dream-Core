/**
 * AbortController 취소로 던져진 예외인지 판별한다.
 *
 * `instanceof DOMException` 을 직접 쓰지 않는 이유: 네이티브(Hermes) 런타임에는
 * DOMException 전역이 없을 수 있어 판별식 자체가 ReferenceError 를 던진다.
 * fetch 구현들이 공통으로 보장하는 것은 `name === 'AbortError'` 다.
 */
export function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name: unknown }).name === 'AbortError'
  );
}
