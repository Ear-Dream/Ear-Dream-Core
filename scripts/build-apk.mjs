/**
 * WebView 셸 APK 빌드.
 *
 *   웹 내보내기(dist/) → 셸 assets/web/ 복사 → gradlew assembleDebug → APK 경로 출력
 *
 * 왜 별도 스크립트인가 — dist 는 Expo 가 만들고 APK 는 Gradle 이 만든다. 둘을 잇는
 * "77MB 를 옮기고 .gz 사이드카는 빼는" 규칙이 어느 쪽에도 자연스럽게 속하지 않는다.
 *
 * `.gz` 를 빼는 이유: 사이드카는 `scripts/serve-mobile.mjs` 가 http 로 내보낼 때 쓰는
 * 것이고(Content-Encoding), APK 안에서는 아무도 읽지 않는다. 그대로 넣으면 34MB 를
 * 헛되이 싣는다.
 *
 * 새 의존성을 쓰지 않는다 — node 내장 모듈만 쓴다 (setup-mediapipe-assets.mjs 와 같은 방침).
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'packages', 'ear-dream-app', 'dist');
const shellDir = join(root, 'packages', 'android-shell');
const assetsDir = join(shellDir, 'app', 'src', 'main', 'assets', 'web');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.lastIndexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

/** 애셋 복사만 하고 Gradle 은 돌리지 않는다. */
const syncOnly = args.includes('--sync-only');
/** 기본 서버 주소를 APK 에 굽는다. 생략하면 앱이 첫 실행 때 물어본다. */
const apiBaseUrl = flag('api', process.env.EAR_DREAM_API_URL ?? '');

// ---------------------------------------------------------------- 웹 애셋

if (!existsSync(join(distDir, 'index.html'))) {
  console.error(
    `웹 내보내기가 없습니다: ${distDir}\n\n먼저 실행하세요:\n  pnpm build:web-mobile\n`,
  );
  process.exit(1);
}

/**
 * 하드링크로 옮긴다 — 77MB 를 매번 복사하면 빌드마다 수 초와 디스크 한 벌이 더 든다.
 * 같은 파일시스템이 아니거나 링크가 막히면 복사로 내려간다.
 */
function place(from, to) {
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

function syncDir(from, to) {
  mkdirSync(to, { recursive: true });
  let count = 0;
  let bytes = 0;

  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);

    if (entry.isDirectory()) {
      const nested = syncDir(source, target);
      count += nested.count;
      bytes += nested.bytes;
      continue;
    }
    // http 전송 계층 전용 사이드카. APK 안에서는 읽는 쪽이 없다.
    if (entry.name.endsWith('.gz')) continue;

    place(source, target);
    count += 1;
    bytes += statSync(source).size;
  }

  return { count, bytes };
}

console.log('웹 애셋 복사 중...');
rmSync(assetsDir, { recursive: true, force: true });
const { count, bytes } = syncDir(distDir, assetsDir);
console.log(`  ${count}개 파일 · ${(bytes / 1024 / 1024).toFixed(1)}MB → app/src/main/assets/web/`);

if (syncOnly) process.exit(0);

// ---------------------------------------------------------------- 툴체인

/**
 * AGP 8.7 은 JDK 17~21 을 요구한다. 이 기계의 기본 JDK 가 그보다 높은 경우가 흔해서
 * (실제로 25 였다) 여기서 맞는 것을 골라 준다. 이미 맞는 JAVA_HOME 이 있으면 그대로 쓴다.
 */
function resolveJavaHome() {
  const current = process.env.JAVA_HOME;
  if (current && isSupportedJdk(current)) return current;

  for (const version of ['21', '17']) {
    const found = spawnSync('/usr/libexec/java_home', ['-v', version], { encoding: 'utf8' });
    if (found.status === 0) return found.stdout.trim();
  }
  return current ?? '';
}

function isSupportedJdk(javaHome) {
  const probe = spawnSync(join(javaHome, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
  const major = Number(/version "(\d+)/.exec(probe.stderr ?? '')?.[1]);
  return major >= 17 && major <= 21;
}

/** ANDROID_HOME 이 없는 것이 기본이라(Android Studio 가 설정하지 않는다) 표준 위치를 본다. */
function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ];
  return candidates.find((path) => path && existsSync(join(path, 'platforms')));
}

const javaHome = resolveJavaHome();
const androidSdk = resolveAndroidSdk();

if (!androidSdk) {
  console.error(
    'Android SDK 를 찾지 못했습니다. ANDROID_HOME 을 설정하거나 Android Studio 로 SDK 를 받으세요.',
  );
  process.exit(1);
}

console.log(`JDK      ${javaHome || '(기본값)'}`);
console.log(`SDK      ${androidSdk}`);
console.log(`서버 주소 ${apiBaseUrl || '(빌드에 굽지 않음 — 앱이 첫 실행 때 물어봅니다)'}`);

// ---------------------------------------------------------------- Gradle

const gradleArgs = ['assembleDebug'];
if (apiBaseUrl) gradleArgs.push(`-PearDream.apiBaseUrl=${apiBaseUrl}`);

const build = spawnSync('./gradlew', gradleArgs, {
  cwd: shellDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidSdk,
    ANDROID_SDK_ROOT: androidSdk,
  },
});

if (build.status !== 0) process.exit(build.status ?? 1);

const apk = join(shellDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const size = existsSync(apk) ? `${(statSync(apk).size / 1024 / 1024).toFixed(1)}MB` : '?';

verifyAssets(apk, count);

console.log(`\nAPK  ${apk}  (${size})`);
console.log('설치:  adb install -r ' + apk);

/**
 * 옮긴 파일 수와 APK 안의 애셋 수를 대조한다.
 *
 * 왜 필요한가 — **aapt 는 애셋을 조용히 버린다.** 기본 무시 패턴에 `<dir>_*` 가 있어서
 * Expo 의 `_expo/`(JS 번들 전체)가 통째로 빠졌던 적이 있다. 빌드는 성공하고 앱도 뜨는데
 * 화면만 비어서, 원인이 빌드에 있다는 것 자체를 의심하기까지 오래 걸린다.
 * `app/build.gradle.kts` 의 ignoreAssetsPatterns 가 그 구멍을 막았고, 여기서는 그것이
 * 계속 유효한지 매 빌드마다 확인한다.
 */
function verifyAssets(apkPath, expected) {
  const listing = spawnSync('unzip', ['-l', apkPath], { encoding: 'utf8' });
  if (listing.status !== 0) return; // unzip 이 없으면 확인을 건너뛴다 — 빌드를 막을 일은 아니다.

  const packed = listing.stdout.split('\n').filter((line) => line.includes('assets/web/')).length;
  if (packed === expected) return;

  console.error(
    `\n⚠️ 애셋 ${expected}개를 옮겼는데 APK 에는 ${packed}개만 들어 있습니다.` +
      '\n   aapt 가 일부를 버렸습니다 — app/build.gradle.kts 의 ignoreAssetsPatterns 를 확인하세요.',
  );
  process.exit(1);
}
