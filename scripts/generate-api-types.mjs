import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Windows 에서 uv/pnpm 은 .cmd 래퍼라 shell 을 거쳐야 실행된다.
const useShell = process.platform === 'win32';

function run(command, args, cwd) {
  const { status, error } = spawnSync(command, args, { cwd, stdio: 'inherit', shell: useShell });

  if (error?.code === 'ENOENT') {
    console.error(`\n'${command}' 명령을 찾을 수 없습니다. 설치되어 있는지 확인하세요.`);
    process.exit(1);
  }
  if (status !== 0) {
    process.exit(status ?? 1);
  }
}

console.log('==> FastAPI 스키마에서 openapi.json 내보내는 중');
run('uv', ['run', 'python', 'scripts/export_openapi.py'], join(root, 'packages', 'ear-dream-api'));

console.log('==> TypeScript 타입 생성 중');
run('pnpm', ['--filter', '@ear-dream/core', 'generate'], root);

console.log('==> 완료');
