/**
 * 수어 인식 모델 번들을 `var/models/` 아래에 설치한다.
 *
 * 실제 작업은 API 패키지의 빌드 스크립트가 한다 — 학습 레포(공개 저장소)의 **고정 커밋**
 * 에서 TorchScript 를 받아 release.json 과 함께 번들을 만든다. 그래서 이 명령은 어느
 * 기계에서든 같은 산출물을 만들고, 별도의 릴리스 업로드 단계가 필요 없다.
 *
 * 번들을 커밋하지 않는 이유는 MediaPipe 애셋과 같다 — 재생성이 가능한 대용량 바이너리다.
 *
 * 번들이 없어도 서버는 뜬다 — `/recognize` 만 503 이고 나머지 흐름(문장 변환·아바타·
 * 음성)은 그대로 돈다. 그래서 이 스크립트는 `dev:api` 에 묶지 않고 따로 둔다.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'packages', 'ear-dream-api');

// config.py 의 model_bundle_dir 기본값과 같은 위치여야 한다.
const BUNDLE = 'single-observed-300-allpeople';
const BUNDLE_DIR = join(apiDir, 'var', 'models', BUNDLE);
const BUILD_SCRIPT = 'scripts/build_single_observed_bundle.py';

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

  console.log(`==> 모델 번들 생성 중 (${BUNDLE})`);
  console.log('    학습 레포 고정 커밋에서 TorchScript 를 내려받습니다 (약 26MB)');
  const code = await new Promise((resolve) => {
    spawn('uv', ['run', 'python', BUILD_SCRIPT], { cwd: apiDir, stdio: 'inherit' }).on(
      'close',
      resolve,
    );
  });
  if (code !== 0) {
    console.error(
      `\n번들 생성 실패 (exit ${code}).\n` +
        `- uv 가 설치돼 있는지: https://docs.astral.sh/uv/\n` +
        `- 의존성이 받아졌는지: (cd packages/ear-dream-api && uv sync)\n` +
        `- 네트워크가 GitHub 에 닿는지\n` +
        `다른 번들이나 다른 커밋이 필요하면 ${BUILD_SCRIPT} 의 --run/--ref 를 쓰세요.\n`,
    );
    process.exit(1);
  }
  console.log('    확인: pnpm dev:api 후 http://localhost:8000/health 의 model_loaded');
}

await main();
