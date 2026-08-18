/**
 * Noto Sans KR 을 **한국어 서브셋**으로 줄여 앱 자산으로 내보낸다.
 *
 * 왜 —
 *   @expo-google-fonts 가 주는 원본은 가중치당 6.19MB(전송 3.01MB)다. 세 가중치를
 *   합치면 8.66MB 이고, App.tsx 의 useFonts 가 이걸 다 받을 때까지 **화면을 막는다**.
 *   약한 4G 에서 14초 동안 흰 화면이라 데이터 요금 이전에 이탈 문제다.
 *   덩치의 대부분은 한자(CJK 통합 한자) 글리프인데 이 앱은 한 자도 쓰지 않는다.
 *
 * 커버리지 — 한글 음절 **전체 11,172자**를 남긴다.
 *   앱 UI 문자열과 300단어 어휘는 KS X 1001 상용 2350자 안에 전부 들어가고, 그걸로
 *   줄이면 전송이 0.49MB 까지 떨어진다. 그래도 전체를 남기는 이유는 **청인 트랙의
 *   STT 출력이 임의의 한국어**라서다 — 사용자가 말한 낱말에 상용 밖 음절(똠·뷁·쏀)이
 *   하나 섞이면 문장 한가운데 두부(□)가 뜬다. 그 위험을 없애는 값이 1.1MB 다.
 *   나중에 그 1.1MB 가 아쉬워지면 HANGUL_RANGE 를 2350 리스트로 바꾸면 된다.
 *
 * 산출(가중치당) — 전송 기준 3.01MB → woff2 0.52MB (웹) / gz 씌운 ttf 0.84MB (네이티브)
 *
 * 도구는 fonttools(pyftsubset)를 **uvx 로 일회성 실행**한다. 이 레포는 이미 uv 를
 * 요구하므로(ear-dream-api) 새로 설치할 게 없고, 레포에 영구 의존성도 남지 않는다.
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'packages', 'ear-dream-app');
const outDir = join(appRoot, 'assets', 'fonts');

const WEIGHTS = [
  { dir: '400Regular', file: 'NotoSansKR_400Regular' },
  { dir: '500Medium', file: 'NotoSansKR_500Medium' },
  { dir: '700Bold', file: 'NotoSansKR_700Bold' },
];

/** 한글 음절 전체. 위 주석의 트레이드오프를 바꾸려면 여기다. */
const HANGUL_RANGE = 'U+AC00-D7A3';

const UNICODES = [
  'U+0020-007E', // ASCII
  'U+00A0-00FF', // 라틴-1 (× ÷ 등 포함)
  'U+2000-206F', // 일반 구두점 (… — ‘’ “” •)
  'U+2190-2199', // 화살표
  'U+20A9', // ₩
  'U+20AC', // €
  'U+3000-303F', // CJK 구두점 (、。「」)
  'U+3130-318F', // 호환 자모 (ㄱ ㅏ — 낱자 표시용)
  HANGUL_RANGE,
  'U+FF01-FF60', // 전각 형태
].join(',');

/**
 * 서브셋 규격이 바뀌면 산출물을 다시 만들어야 한다. 원본 mtime 만 보면 규격 변경을
 * 놓치므로 규격 자체를 스탬프에 적어 둔다.
 */
const SPEC = JSON.stringify({ version: 1, unicodes: UNICODES });
const stampPath = join(outDir, '.subset.json');

function sourceDir() {
  const require = createRequire(join(appRoot, 'package.json'));
  const pkg = require.resolve('@expo-google-fonts/noto-sans-kr/package.json');
  return dirname(pkg);
}

async function isFresh(sources) {
  try {
    if ((await readFile(stampPath, 'utf8')) !== SPEC) return false;
    const stamp = await stat(stampPath);
    for (const source of sources) {
      if ((await stat(source)).mtimeMs > stamp.mtimeMs) return false;
    }
    for (const { file } of WEIGHTS) {
      await stat(join(outDir, `${file}.ttf`));
      await stat(join(outDir, `${file}.woff2`));
    }
    return true;
  } catch {
    return false;
  }
}

async function subset(source, output, flavor) {
  const args = [
    '--with',
    'brotli', // woff2 출력에 필요하다
    '--from',
    'fonttools',
    'pyftsubset',
    source,
    `--output-file=${output}`,
    `--unicodes=${UNICODES}`,
    // 힌팅은 한글 글리프에서 용량을 크게 먹는데 요즘 렌더러는 자체 힌팅을 쓴다.
    '--no-hinting',
  ];
  if (flavor) args.push(`--flavor=${flavor}`);
  await run('uvx', args);
}

const src = sourceDir();
const sources = WEIGHTS.map(({ dir, file }) => join(src, dir, `${file}.ttf`));

if (await isFresh(sources)) {
  console.log('  폰트 서브셋 최신 — 건너뜁니다.');
  process.exit(0);
}

try {
  await run('uvx', ['--version']);
} catch {
  console.error(
    'uvx 를 찾지 못했습니다. 폰트 서브셋에는 uv 가 필요합니다 (이 레포는 API 서버에도 uv 를 씁니다).\n' +
      '  설치: https://docs.astral.sh/uv/getting-started/installation/\n',
  );
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const mb = (bytes) => (bytes / 1_048_576).toFixed(2);
let before = 0;
let after = 0;

for (const [i, { file }] of WEIGHTS.entries()) {
  const source = sources[i];
  process.stdout.write(`  ${file} 서브셋 중...`);
  // 웹은 woff2(자체 압축), 네이티브(Expo Go)는 ttf. src/constants/fonts[.web].ts 참고.
  await subset(source, join(outDir, `${file}.woff2`), 'woff2');
  await subset(source, join(outDir, `${file}.ttf`), null);
  const [srcInfo, woff2Info] = await Promise.all([
    stat(source),
    stat(join(outDir, `${file}.woff2`)),
  ]);
  before += srcInfo.size;
  after += woff2Info.size;
  console.log(` ${mb(srcInfo.size)}MB → ${mb(woff2Info.size)}MB (woff2)`);
}

await writeFile(stampPath, SPEC);
console.log(`  폰트 서브셋 완료: ${mb(before)}MB → ${mb(after)}MB (웹 기준)`);
