/**
 * 수어 인식 모델 번들을 GitHub Release 에서 받아 `var/models/` 아래에 푼다.
 *
 * 번들을 커밋하지 않는 이유는 MediaPipe 자산과 같다 — 재생성이 가능한 대용량
 * 바이너리다. 다만 MediaPipe 와 달리 **이건 공개 CDN 에 없다.** 학습 레포
 * (Ear-Dream-Benchmarks) 산출물이라, 그 레포 접근권이 없는 사람은 릴리스로만 받는다.
 *
 * 번들이 없어도 서버는 뜬다 — `/recognize` 만 503 이고 나머지 흐름(문장 변환·아바타·
 * 음성)은 그대로 돈다. 그래서 이 스크립트는 `dev:api` 에 묶지 않고 따로 둔다.
 *
 * 올리는 쪽 절차는 README 「모델 번들」 참고 (tar + gh release).
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 릴리스 규약. 번들을 새로 만들어 올릴 때 태그와 파일명을 여기와 맞춘다.
const REPO = 'Ear-Dream/Ear-Dream-Core';
const TAG = 'model-spoter300-pilot';
const ASSET = 'spoter300-pilot.tar.gz';
const ASSET_URL = `https://github.com/${REPO}/releases/download/${TAG}/${ASSET}`;

// config.py 의 model_bundle_dir 기본값과 같은 위치여야 한다.
const BUNDLE_DIR = join(root, 'packages', 'ear-dream-api', 'var', 'models', 'spoter300-pilot');

// 로더(app/ml/model.py)가 반드시 읽는 파일. live_debias.npy 는 없어도 동작한다
// (α=0 항등 + 경고 1회) — 그래서 필수 목록에 넣지 않고 경고만 한다.
const REQUIRED = ['release.json', 'model_torchscript.pt'];
const OPTIONAL = ['live_debias.npy'];

const force = process.argv.includes('--force');

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function main() {
  if (!force && (await exists(join(BUNDLE_DIR, 'release.json')))) {
    console.log(`==> 모델 번들 이미 존재, 건너뜀 (${BUNDLE_DIR})`);
    console.log('    다시 받으려면: pnpm setup:model-bundle --force');
    return;
  }

  console.log(`==> 모델 번들 다운로드 중 (${TAG}/${ASSET})`);
  const response = await fetch(ASSET_URL, { redirect: 'follow' });
  if (!response.ok) {
    // 404 는 "아직 안 올렸다" 가 대부분이라 원인을 갈라서 안내한다.
    const hint =
      response.status === 404
        ? `릴리스 ${TAG} 또는 첨부 ${ASSET} 가 아직 없습니다.\n` +
          `번들을 가진 팀원이 README 「모델 번들」의 업로드 절차를 한 번 실행해야 합니다.\n` +
          `학습 산출물이 로컬에 있다면 직접 만들 수도 있습니다:\n` +
          `  cd packages/ear-dream-api && uv run python scripts/build_spoter300_bundle.py`
        : `잠시 후 다시 시도하세요.`;
    console.error(`\n다운로드 실패 (HTTP ${response.status})\n${ASSET_URL}\n\n${hint}\n`);
    process.exit(1);
  }

  const staging = await mkdtemp(join(tmpdir(), 'ear-dream-bundle-'));
  const archive = join(staging, ASSET);
  try {
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));

    console.log('==> 압축 해제 중');
    await mkdir(BUNDLE_DIR, { recursive: true });
    // tar 는 macOS/Linux 기본 제공이고 Windows 10+ 에도 bsdtar 가 들어 있다.
    // --strip-components=1: 아카이브가 spoter300-pilot/ 디렉토리를 품고 있어도 평탄화한다.
    await run('tar', ['-xzf', archive, '-C', BUNDLE_DIR, '--strip-components=1']);

    const missing = [];
    for (const name of REQUIRED) {
      if (!(await exists(join(BUNDLE_DIR, name)))) missing.push(name);
    }
    if (missing.length > 0) {
      console.error(
        `\n번들에 필수 파일이 없습니다: ${missing.join(', ')}\n` +
          `첨부 파일이 올바른지 확인하세요 (${ASSET_URL}).\n`,
      );
      process.exit(1);
    }
    for (const name of OPTIONAL) {
      if (!(await exists(join(BUNDLE_DIR, name)))) {
        console.warn(`경고: ${name} 이 없습니다 — 라이브 편향 제거 없이 동작합니다(α=0).`);
      }
    }

    console.log(`==> 완료 (${BUNDLE_DIR})`);
    console.log('    확인: pnpm dev:api 후 http://localhost:8000/health 의 model_loaded');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\n${error.message ?? error}\n`);
  process.exit(1);
});
