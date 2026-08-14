/**
 * 실기기 테스트용 로컬 https 인증서를 만든다 (mkcert).
 *
 * 실기기 브라우저는 localhost 밖에서 `getUserMedia` 에 https 를 요구한다. 자체서명
 * 인증서를 그냥 쓰면 폰이 경고를 띄우고, 경고를 넘겨도 iOS 는 예외가 잘 유지되지 않는다.
 * mkcert 는 **로컬 CA** 를 만들어 서명하므로, 폰에 그 CA 를 한 번 설치하면 이후로는
 * 경고 없이 진짜 https 로 동작한다.
 *
 * 이 방식은 현장 네트워크나 외부 터널 서비스에 의존하지 않는다 — CDN 직로드를 쓰지 않는
 * 것과 같은 이유다 (README 「실기기 모바일 웹」).
 *
 * 인증서는 var/certs/ 에 만들고 .gitignore 대상이다. 커밋하지 말 것 —
 * 개인 키이고, 기계마다 LAN IP 가 다르다.
 */

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = join(root, 'var', 'certs');

const lanIps = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => n.address);

if (lanIps.length === 0) {
  console.error('LAN IPv4 주소를 찾지 못했습니다. 네트워크에 연결되어 있는지 확인하세요.');
  process.exit(1);
}

// ⚠️ npm 에 **같은 이름의 다른 패키지**(mkcert, CLI 가 create-ca/create-cert)가 있다.
// 그쪽은 시스템 트러스트 스토어를 건드리지 않아 폰 신뢰 문제를 못 푼다. -CAROOT 지원
// 여부로 진짜 mkcert(FiloSottile)인지 가려낸다.
let caRootPath;
try {
  const { stdout } = await run('mkcert', ['-CAROOT']);
  caRootPath = stdout.trim();
} catch {
  console.error(
    'FiloSottile/mkcert 가 필요합니다.\n\n' +
      '  brew install mkcert\n\n' +
      '⚠️ npm 의 동명 패키지(mkcert)가 PATH 에 먼저 잡혀 있으면 이 스크립트가 실패합니다.\n' +
      '   `mkcert -CAROOT` 가 경로를 출력해야 진짜 mkcert 입니다.\n' +
      '   (Windows: choco install mkcert)\n\n' +
      '인증서를 만들고 싶지 않다면 터널 방식을 쓰세요 — README 「실기기 모바일 웹」.',
  );
  process.exit(1);
}

await mkdir(certDir, { recursive: true });

// 로컬 CA 설치 (이미 있으면 mkcert 가 알아서 건너뛴다)
const { stdout: caOut } = await run('mkcert', ['-install']);
if (caOut.trim()) console.log(caOut.trim());

const hosts = [...lanIps, 'localhost', '127.0.0.1', '::1'];
await run('mkcert', [
  '-key-file',
  join(certDir, 'key.pem'),
  '-cert-file',
  join(certDir, 'cert.pem'),
  ...hosts,
]);

console.log(`\n  인증서 생성 완료 → var/certs/`);
console.log(`    포함된 호스트: ${hosts.join(', ')}\n`);
console.log(`  실기기에서 경고 없이 열려면 이 기계의 루트 CA 를 폰에 설치해야 합니다.`);
console.log(`    CA 파일: ${join(caRootPath, 'rootCA.pem')}\n`);
console.log(`    iOS   : rootCA.pem 을 폰으로 보내(AirDrop/메일) 프로파일 설치 →`);
console.log(`            설정 > 일반 > VPN 및 기기 관리 에서 설치 →`);
console.log(`            설정 > 일반 > 정보 > 인증서 신뢰 설정 에서 **전체 신뢰 켜기**`);
console.log(`            (마지막 단계를 빼먹으면 여전히 경고가 뜹니다)`);
console.log(`    Android: rootCA.pem 을 폰으로 보내 설정 > 보안 > 인증서 설치 > CA 인증서\n`);
