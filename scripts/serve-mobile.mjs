/**
 * 실기기(모바일 웹) 테스트용 단일 오리진 서버.
 *
 *   웹 정적 파일(dist/) + /api·/health 리버스 프록시 → 한 포트, 한 오리진
 *
 * 왜 한 오리진인가 —
 *   1. 실기기 브라우저는 localhost 밖에서 `getUserMedia` 에 **https 를 요구**한다.
 *      페이지가 https 인데 API 가 http 면 mixed content 로 요청이 통째로 막힌다.
 *      둘을 한 오리진에 묶으면 인증서가 하나로 끝나고 API 는 상대경로가 된다.
 *   2. 상대경로가 되면 CORS 도 사라진다.
 *
 * 두 가지 방식을 지원한다. 둘 다 이 서버 하나 위에서 돈다.
 *
 *   [A] LAN + mkcert (기본, --https)
 *       현장 네트워크·외부 서비스에 의존하지 않는다. 폰에 루트 CA 를 한 번 설치해야 한다.
 *       CDN 직로드를 거부한 것과 같은 이유로 이쪽을 기본으로 둔다.
 *
 *   [B] 평문 http 로 띄우고 터널로 감싸기 (사용자에게 링크를 나눠 줄 때)
 *       `node scripts/serve-mobile.mjs --port 8080 --token <시크릿>` + `ngrok http 8080`
 *       인증서 설치가 필요 없는 대신 인터넷과 외부 서비스에 의존한다.
 *       ⚠️ 이때는 주소가 인터넷에 노출된 상태다 — 문서 프록시는 기본으로 꺼져 있고
 *       `--token` 으로 링크를 아는 사람만 들어오게 막는다.
 *
 * 정적 자산은 gzip 사이드카(scripts/precompress-dist.mjs)와 캐시 헤더로 내보낸다.
 * 첫 로드가 약 28MB 라 터널 경유에서는 이게 곧 체감 속도이자 대역폭이다.
 *
 * 새 의존성을 쓰지 않는다 — node 내장 모듈만 쓴다 (setup-mediapipe-assets.mjs 와 같은 방침).
 */

import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(root, 'packages', 'ear-dream-app', 'dist');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const port = Number(flag('port', process.env.PORT ?? 8443));
const apiTarget = new URL(flag('api', 'http://127.0.0.1:8000'));
const useHttps = args.includes('--https');
const certDir = flag('cert-dir', join(root, 'var', 'certs'));

/**
 * 공유 시크릿. 주면 링크를 아는 사람만 들어올 수 있다 (`--token abc` 또는 SERVE_TOKEN).
 *
 * 터널로 열면 주소가 인터넷에 노출된 상태가 된다 — 스캐너가 먼저 찾아온다. 인증 체계를
 * 만들 자리는 아니고, 데모 링크를 나눠 주는 정도의 문턱이다. ngrok 무료 플랜에는
 * basic-auth 가 없어서 여기서 막는다.
 */
const accessToken = flag('token', process.env.SERVE_TOKEN ?? '');
const COOKIE_NAME = 'ed_access';

/** API 로 넘길 경로 접두. 그 외는 전부 정적 파일로 처리한다. */
const API_PREFIXES = ['/api/', '/health'];
/**
 * 문서 UI 는 **기본으로 프록시하지 않는다** — 공개 URL 에서 스키마와 Try it out 을
 * 그대로 열어 줄 이유가 없다. 개발 기계에서는 API 오리진(:8000/docs)으로 바로 열면 되고,
 * 폰에서 봐야 하면 `--docs` 로 켠다.
 */
const DOCS_PREFIXES = ['/docs', '/openapi.json', '/redoc'];
const proxyDocs = args.includes('--docs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * 해시가 파일명에 박힌 산출물. 내용이 바뀌면 이름이 바뀌므로 영구 캐시해도 낡은 사본이
 * 남지 않는다.
 */
const IMMUTABLE_PREFIXES = ['/_expo/', '/assets/'];

/**
 * 이름이 고정된 대용량 자산 (MediaPipe wasm·모델 약 28MB, 아바타 시퀀스).
 *
 * 해시가 없어 `immutable` 은 줄 수 없다 — 자산을 교체해도 유효기간 동안 낡은 사본이
 * 쓰인다. 대신 기간을 길게 줘서 재방문 비용을 0 으로 만든다. 터널 경유 공개에서는
 * 이 한 줄이 사용자당 수십 MB 를 좌우한다. 교체 시에는 사용자가 강제 새로고침해야 한다.
 */
const LONG_CACHE_PREFIXES = ['/mediapipe/', '/sign-sequences/'];

/** 30일. 위 대용량 자산용. */
const LONG_CACHE_SECONDS = 30 * 24 * 60 * 60;

/**
 * `.gz` 사이드카가 없을 때 그 자리에서 압축할 확장자 (전부 작은 텍스트다).
 *
 * wasm·모델처럼 큰 바이너리는 여기 넣지 않는다 — 요청마다 11MB 를 다시 압축하면 그
 * CPU 가 그대로 응답 지연이 된다. 그쪽은 빌드 때 만들어 둔다
 * (scripts/precompress-dist.mjs).
 */
const INLINE_GZIP_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg']);

/** 캐시 정책. 경로만 보고 정한다. */
function cacheControl(urlPath) {
  // index.html 은 항상 재검증한다 — 여기가 낡으면 새 빌드가 통째로 안 보인다.
  if (urlPath === '/' || urlPath.endsWith('.html') || urlPath.endsWith('metadata.json')) {
    return 'no-cache';
  }
  if (IMMUTABLE_PREFIXES.some((prefix) => urlPath.startsWith(prefix))) {
    return 'public, max-age=31536000, immutable';
  }
  if (LONG_CACHE_PREFIXES.some((prefix) => urlPath.startsWith(prefix))) {
    return `public, max-age=${LONG_CACHE_SECONDS}`;
  }
  return 'public, max-age=3600';
}

/** 약한 ETag. 내용 해시가 아니라 크기+mtime 이면 이 용도에는 충분하다. */
const etagFor = (info) => `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;

const acceptsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');

function proxyToApi(req, res) {
  // 업로드가 세그먼트당 수 MB 라 스트리밍으로 그대로 흘려보낸다 (버퍼링하지 않는다).
  const upstream = http.request(
    {
      protocol: apiTarget.protocol,
      hostname: apiTarget.hostname,
      port: apiTarget.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: apiTarget.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', (error) => {
    // API 서버가 안 떠 있는 흔한 경우. 폰 화면에서 원인을 알 수 있게 본문에 적어 준다.
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        detail: `API 서버(${apiTarget.origin})에 연결하지 못했습니다: ${error.message}`,
      }),
    );
  });

  req.pipe(upstream);
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // 경로 이탈(../) 차단 — dist 밖 파일이 나가면 안 된다.
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(webRoot, safe);
  let servedPath = safe;

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
      servedPath = join(safe, 'index.html');
    }
  } catch {
    // SPA fallback — 알 수 없는 경로는 index.html 로 넘긴다.
    filePath = join(webRoot, 'index.html');
    servedPath = '/index.html';
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `dist/ 에 파일이 없습니다: ${safe}\n\n먼저 웹을 내보내세요:\n  pnpm build:web-mobile\n`,
    );
    return;
  }

  const etag = etagFor(info);
  const headers = {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(servedPath),
    ETag: etag,
    'Last-Modified': new Date(info.mtimeMs).toUTCString(),
    // 같은 URL 이 압축본/원본 두 가지로 나가므로 중간 캐시가 섞지 않게 알린다.
    Vary: 'Accept-Encoding',
  };
  // MediaPipe WASM 은 SharedArrayBuffer 를 쓰지 않는 빌드지만, 스레드 빌드로 바뀌어도
  // 바로 돌도록 격리 헤더를 함께 준다. 같은 오리진이라 부작용이 없다.
  if (filePath.endsWith('.html')) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
  }

  // 재방문의 대부분은 여기서 끝난다 — 28MB 대신 헤더만 오간다.
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (acceptsGzip(req)) {
    // 1순위: 빌드 때 만들어 둔 .gz (scripts/precompress-dist.mjs).
    try {
      const gzPath = `${filePath}.gz`;
      const gzInfo = await stat(gzPath);
      res.writeHead(200, {
        ...headers,
        'Content-Encoding': 'gzip',
        'Content-Length': gzInfo.size,
      });
      createReadStream(gzPath).pipe(res);
      return;
    } catch {
      // 사이드카가 없다 — 아래로 내려간다.
    }

    // 2순위: 작은 텍스트만 그 자리에서 압축한다 (Content-Length 는 알 수 없어 생략).
    if (INLINE_GZIP_EXT.has(extname(filePath))) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      createReadStream(filePath).pipe(createGzip()).pipe(res);
      return;
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  createReadStream(filePath).pipe(res);
}

/** 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다. */
function secretMatches(candidate) {
  const a = Buffer.from(candidate ?? '');
  const b = Buffer.from(accessToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * 접근 게이트. `?k=<시크릿>` 으로 한 번 들어오면 쿠키로 바꿔 주고 주소에서 지운다 —
 * 시크릿이 히스토리·Referer 에 남지 않게 하고, 이후 요청(자산·API)은 쿠키로 통과한다.
 *
 * 반환값이 true 면 이 요청은 여기서 끝났다는 뜻이다.
 */
function gate(req, res) {
  if (!accessToken) return false;
  if (secretMatches(cookieValue(req, COOKIE_NAME))) return false;

  const url = new URL(req.url, 'http://x');
  if (secretMatches(url.searchParams.get('k'))) {
    url.searchParams.delete('k');
    res.writeHead(302, {
      // Secure 는 붙이지 않는다 — 터널 뒤에서는 이 서버가 평문 http 로 받으므로
      // 브라우저가 https 여도 서버는 그걸 알 수 없다. 시크릿 자체가 문턱이다.
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
      Location: url.pathname + (url.search || ''),
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('<meta charset="utf-8"><p>초대 링크로 열어 주세요.</p>');
  return true;
}

function handler(req, res) {
  if (gate(req, res)) return;

  if (DOCS_PREFIXES.some((prefix) => req.url.startsWith(prefix))) {
    if (proxyDocs) proxyToApi(req, res);
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('API 문서는 이 오리진에서 열지 않습니다 (--docs 로 켤 수 있습니다).\n');
    }
    return;
  }

  if (API_PREFIXES.some((prefix) => req.url.startsWith(prefix))) {
    proxyToApi(req, res);
    return;
  }
  void serveStatic(req, res);
}

const lanIp =
  Object.values(networkInterfaces())
    .flat()
    .find((n) => n && n.family === 'IPv4' && !n.internal)?.address ?? 'localhost';

let server;
if (useHttps) {
  let key, cert;
  try {
    key = await readFile(join(certDir, 'key.pem'));
    cert = await readFile(join(certDir, 'cert.pem'));
  } catch {
    console.error(
      `인증서를 찾지 못했습니다: ${certDir}\n\n` +
        `먼저 만드세요 (mkcert 필요):\n` +
        `  pnpm setup:https-cert\n`,
    );
    process.exit(1);
  }
  server = https.createServer({ key, cert }, handler);
} else {
  server = http.createServer(handler);
}

server.listen(port, '0.0.0.0', () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`\n  웹 + API 단일 오리진 서버\n`);
  console.log(`    이 기계:  ${scheme}://localhost:${port}`);
  console.log(`    실기기:   ${scheme}://${lanIp}:${port}`);
  console.log(`    API 프록시 → ${apiTarget.origin}${proxyDocs ? ' (문서 포함)' : ''}`);
  if (accessToken) {
    console.log(`\n  접근 게이트 켜짐 — 이 주소로 한 번 열어야 합니다:`);
    console.log(`    ${scheme}://${lanIp}:${port}/?k=${encodeURIComponent(accessToken)}`);
  }
  if (!useHttps) {
    console.log(
      `\n  ⚠️  평문 http 라 localhost 밖에서는 카메라(getUserMedia)가 막힙니다.\n` +
        `     --https 로 띄우거나 터널로 감싸세요 (README 「실기기 모바일 웹」).`,
    );
  }
  console.log('');
});
