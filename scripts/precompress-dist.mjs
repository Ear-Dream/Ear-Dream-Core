/**
 * 내보낸 웹(dist/)의 큰 애셋을 gzip 으로 미리 압축해 `.gz` 사이드카를 만든다.
 *
 * 왜 미리 만드나 —
 *   터널(ngrok) 경유로 공개하면 첫 로드가 실측 약 28MB 다 (wasm 11.2 + 손 7.5 +
 *   얼굴 3.6 + 포즈 5.5 + 번들 0.7). gzip 을 씌우면 약 17MB 로 줄어드는데, 요청마다
 *   11MB wasm 을 다시 압축하면 그 CPU 가 응답 지연이 된다. 빌드 때 한 번 만들어 두고
 *   서버는 골라 보내기만 한다 (scripts/serve-mobile.mjs).
 *
 * 압축률(실측): wasm 3.4배, .task 모델 1.2~1.3배, JS 번들 3.5배.
 * 모델은 이득이 작지만 재압축 비용이 없으므로 함께 만들어 둔다.
 *
 * 새 의존성을 쓰지 않는다 — node 내장 모듈만 쓴다 (serve-mobile.mjs 와 같은 방침).
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = join(root, 'packages', 'ear-dream-app', 'dist');

/**
 * 압축이 의미 있는 확장자. 이미 압축된 포맷(png·jpg·**woff2**)은 넣지 않는다 —
 * woff2 는 내부가 brotli 라 다시 씌워 봐야 커지기만 한다.
 *
 * `.bin` 은 아바타 시퀀스다 (sign-sequences/, 300단어 20MB). 좌표 이진이라 1.7~1.9배로
 * 줄고, 문장마다 단어 수만큼 받으므로 이득이 반복된다.
 */
const TARGET_EXT = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.wasm',
  '.task',
  '.ttf',
  '.otf',
  '.bin',
]);

/** 이보다 작은 파일은 건너뛴다 — 줄어드는 양보다 요청 오버헤드가 크다. */
const MIN_BYTES = 4 * 1024;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

async function isStale(source, gzPath) {
  try {
    const [src, gz] = await Promise.all([stat(source), stat(gzPath)]);
    return gz.mtimeMs < src.mtimeMs;
  } catch {
    return true; // .gz 가 없다
  }
}

try {
  await stat(webRoot);
} catch {
  console.error(`dist/ 가 없습니다: ${webRoot}\n\n먼저 웹을 내보내세요:\n  pnpm build:web-mobile\n`);
  process.exit(1);
}

let compressed = 0;
let skipped = 0;
let rawTotal = 0;
let gzTotal = 0;

for await (const file of walk(webRoot)) {
  if (file.endsWith('.gz')) continue;
  if (!TARGET_EXT.has(extname(file))) continue;

  const info = await stat(file);
  if (info.size < MIN_BYTES) continue;

  const gzPath = `${file}.gz`;
  if (!(await isStale(file, gzPath))) {
    skipped += 1;
    continue;
  }

  try {
    await pipeline(createReadStream(file), createGzip(), createWriteStream(gzPath));
  } catch (error) {
    // 중간에 끊긴 .gz 가 남으면 서버가 깨진 본문을 보낸다. 지우고 다음으로 넘어간다.
    await unlink(gzPath).catch(() => {});
    console.error(`  압축 실패 (건너뜀): ${file} — ${error.message}`);
    continue;
  }

  const gzInfo = await stat(gzPath);
  compressed += 1;
  rawTotal += info.size;
  gzTotal += gzInfo.size;
}

const mb = (bytes) => (bytes / 1_048_576).toFixed(1);
console.log(
  `  gzip 사이드카 ${compressed}개 생성 (최신 ${skipped}개 건너뜀): ` +
    `${mb(rawTotal)}MB → ${mb(gzTotal)}MB`,
);
