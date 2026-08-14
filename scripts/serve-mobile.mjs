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
 *   [B] 평문 http 로 띄우고 터널로 감싸기
 *       `node scripts/serve-mobile.mjs` (평문) + `ngrok http 8080`
 *       인증서 설치가 필요 없는 대신 인터넷과 외부 서비스에 의존한다.
 *
 * 새 의존성을 쓰지 않는다 — node 내장 모듈만 쓴다 (setup-mediapipe-assets.mjs 와 같은 방침).
 */

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** API 로 넘길 경로 접두. 그 외는 전부 정적 파일로 처리한다. */
const API_PREFIXES = ['/api/', '/health', '/docs', '/openapi.json'];

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

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback — 알 수 없는 경로는 index.html 로 넘긴다.
    filePath = join(webRoot, 'index.html');
  }

  try {
    await stat(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `dist/ 에 파일이 없습니다: ${safe}\n\n먼저 웹을 내보내세요:\n  pnpm build:web-mobile\n`,
    );
    return;
  }

  const headers = { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' };
  // MediaPipe WASM 은 SharedArrayBuffer 를 쓰지 않는 빌드지만, 스레드 빌드로 바뀌어도
  // 바로 돌도록 격리 헤더를 함께 준다. 같은 오리진이라 부작용이 없다.
  if (filePath.endsWith('.html')) {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
  }
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

function handler(req, res) {
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
  console.log(`    API 프록시 → ${apiTarget.origin}`);
  if (!useHttps) {
    console.log(
      `\n  ⚠️  평문 http 라 localhost 밖에서는 카메라(getUserMedia)가 막힙니다.\n` +
        `     --https 로 띄우거나 터널로 감싸세요 (README 「실기기 모바일 웹」).`,
    );
  }
  console.log('');
});
