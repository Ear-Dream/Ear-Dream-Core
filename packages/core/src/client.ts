import createClient from "openapi-fetch";

import type { paths } from "./generated/schema";

/**
 * 이 크기(바이트 근사)를 넘는 요청 본문만 압축한다.
 *
 * 작은 요청은 압축해 봐야 줄어드는 양보다 왕복 오버헤드가 크다. `/recognize` 세그먼트가
 * 수 MB 라 실제로 걸리는 건 사실상 그것 하나다 (compose-sentence·speech 는 수백 바이트).
 * 임시값 — 실측 후 조정한다.
 */
const COMPRESS_MIN_BYTES = 64 * 1024;

/**
 * 요청 본문을 gzip 으로 압축한다. 브라우저가 지원하지 않으면 null.
 *
 * **지연을 더하지 않는다.** CompressionStream 은 네이티브 구현이라 JS 압축 라이브러리와
 * 비교가 안 되게 빠르고, 무엇보다 **느린 업링크에서는 압축이 전체 시간을 줄인다** —
 * 6MB 를 10Mbps 로 올리면 4.8초인데, 2.8MB 로 줄이면 2.2초 + 압축 0.1초 수준이다.
 * 스트림 파이프라인이라 메인 스레드를 붙잡지도 않는다.
 *
 * Safari 는 16.4+(iOS 16.4+)부터 지원한다. 그 이하에서는 압축 없이 그대로 보낸다 —
 * 동작이 막히지 않아야 하므로 실패는 조용한 폴백이다.
 */
async function gzipBody(body: ArrayBuffer): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([body])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

/**
 * 큰 JSON 본문을 gzip 으로 보내는 fetch 래퍼.
 *
 * 전송 계층에서만 줄인다 — 서버가 풀면 바이트가 동일하므로 학습 계약(좌표 정밀도·얼굴
 * 점 개수)은 그대로다. 서버 해제는 app/core/compression.py.
 */
async function compressingFetch(request: Request): Promise<Response> {
  if (request.body === null) return fetch(request);

  // clone 으로 읽어야 원본 body 가 소비되지 않는다. byteLength 는 UTF-16 길이가 아닌
  // 실제 바이트라 임계 판단이 정확하다.
  const body = await request.clone().arrayBuffer();
  if (body.byteLength < COMPRESS_MIN_BYTES) return fetch(request);

  const compressed = await gzipBody(body);
  if (!compressed) return fetch(request);

  const headers = new Headers(request.headers);
  headers.set("Content-Encoding", "gzip");
  // Content-Type 은 그대로 둔다 — 본문은 여전히 JSON 이고 인코딩만 씌운 것이다.
  return fetch(
    new Request(request.url, {
      method: request.method,
      headers,
      body: compressed,
      // 취소(AbortController)가 압축된 요청에도 그대로 걸려야 한다.
      signal: request.signal,
      credentials: request.credentials,
      mode: request.mode,
      referrer: request.referrer,
    }),
  );
}

export interface ApiClientOptions {
  /**
   * 큰 요청 본문을 gzip 으로 보낸다. 기본 true.
   *
   * 서버가 `Content-Encoding: gzip` 을 해제하지 못하는 환경(구버전 서버, 중간 프록시)
   * 에서만 끈다.
   */
  compressRequests?: boolean;
}

export function createApiClient(baseUrl: string, options: ApiClientOptions = {}) {
  const { compressRequests = true } = options;
  return createClient<paths>({
    baseUrl,
    ...(compressRequests ? { fetch: compressingFetch } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
