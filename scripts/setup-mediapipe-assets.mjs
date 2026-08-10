/**
 * MediaPipe 실행에 필요한 WASM 런타임과 랜드마크 모델(손 · 얼굴)을 앱의 public/ 아래로 준비한다.
 *
 * CDN 직로드를 쓰지 않는 이유: 데모 현장 네트워크에 의존하게 된다.
 * 대신 설치 시점에 한 번 로컬로 받아두고, 실행 중에는 같은 오리진에서만 읽는다.
 *
 * 산출물은 .gitignore 되어 있다 (실측 약 45MB — WASM 약 34MB + 모델 약 11MB). 재생성이 가능하고
 * 라이선스가 별도인 바이너리를 public 레포에 커밋하지 않기 위해서다.
 */
import { createRequire } from 'node:module';
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = join(root, 'packages', 'ear-dream-app');
const publicRoot = join(appRoot, 'public', 'mediapipe');

// 모델 파일. 버전 디렉토리(.../1/)가 URL 에 포함되어 있으므로 갱신 시 URL 을 함께 올린다.
//
// 손과 얼굴을 따로 받는다. Holistic 단일 번들을 쓰지 않는 이유는 useLandmarker.web.ts 주석 참고
// (손을 좌우로 미리 갈라서 주기 때문에 지금 검증해야 할 handedness 라벨이 모델 안으로 숨는다).
const MODELS = [
  {
    label: '손 랜드마크 모델',
    filename: 'hand_landmarker.task',
    sizeHint: '약 7.5MB',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    label: '얼굴 랜드마크 모델',
    filename: 'face_landmarker.task',
    sizeHint: '약 3.7MB',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    // 어깨 기준 정규화(방향 전환)에 필요한 포즈 랜드마크 모델.
    // lite 를 고른 이유: 지금 필요한 것은 어깨 양 포인트(큰 관절)라 lite 정밀도로 충분하다는
    // 판단이다. 다만 이것은 실측 비교(lite vs full) 없이 내린 **임시 선택**이며,
    // 어깨 좌표 품질이 정규화에 부족하다고 실측되면 full/heavy 로 올리고 URL 을 함께 바꾼다.
    label: '포즈 랜드마크 모델',
    filename: 'pose_landmarker_lite.task',
    sizeHint: '약 5.5MB',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
];

async function exists(path) {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
}

function resolvePackageDir() {
  // exports 맵에 선언된 서브패스로 해석해야 한다. package.json 은 exports 에 없어서 실패한다.
  const require = createRequire(join(appRoot, 'package.json'));
  try {
    return dirname(require.resolve('@mediapipe/tasks-vision/vision_wasm_internal.wasm'));
  } catch {
    console.error('\n@mediapipe/tasks-vision 를 찾을 수 없습니다. 먼저 `pnpm install` 을 실행하세요.');
    process.exit(1);
  }
}

async function copyWasmRuntime(wasmDir) {
  const target = join(publicRoot, 'wasm');

  if (await exists(join(target, 'vision_wasm_internal.wasm'))) {
    console.log('==> WASM 런타임 이미 존재, 건너뜀');
    return;
  }

  console.log('==> WASM 런타임 복사 중');
  // 디렉토리 전체를 복사한다. FilesetResolver 는 SIMD 지원 여부에 따라 파일명을 런타임에
  // 조합하므로(vision_wasm_internal / vision_wasm_nosimd_internal), 일부만 두면 환경에 따라 404 가 난다.
  await mkdir(target, { recursive: true });
  await cp(wasmDir, target, { recursive: true });
}

/**
 * MediaPipe 라이브러리 본체(IIFE 빌드)를 public/ 으로 복사한다.
 *
 * 번들러로 import 하지 않고 런타임에 <script> 로 읽는 이유:
 * tasks-vision 의 ESM/CJS 빌드에는 인자가 정적 문자열이 아닌 `import(t.toString())` 가 들어 있는데,
 * Metro 는 이런 동적 import 를 트랜스폼 단계에서 거부한다("Invalid call"). 해당 코드는 모듈 워커
 * 경로의 사실상 죽은 코드지만, Metro 는 실행 여부와 무관하게 파싱 시점에 막는다.
 * IIFE 빌드를 <script> 로 읽으면 Metro 를 통과하지 않으므로 이 문제가 사라진다.
 * 타입은 devDependency 의 vision.d.ts 에서 `import type` 으로 계속 가져오므로 타입 안전성은 그대로다.
 */
async function copyLibraryBundle(packageDir) {
  const target = join(publicRoot, 'vision_bundle.js');

  if (await exists(target)) {
    console.log('==> MediaPipe 라이브러리 이미 존재, 건너뜀');
    return;
  }

  console.log('==> MediaPipe 라이브러리 복사 중');
  await mkdir(publicRoot, { recursive: true });
  await cp(join(packageDir, '..', 'vision_bundle.js'), target);
}

async function downloadModel({ label, filename, sizeHint, url }) {
  const target = join(publicRoot, 'models', filename);

  // 파일 단위로 확인한다. 손 모델만 받아둔 기존 작업 환경에서도 얼굴 모델만 추가로 받게 된다.
  if (await exists(target)) {
    console.log(`==> ${label} 이미 존재, 건너뜀`);
    return;
  }

  console.log(`==> ${label} 다운로드 중 (${sizeHint})`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`\n모델 다운로드 실패: HTTP ${response.status} ${url}`);
    process.exit(1);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

const wasmDir = resolvePackageDir();
await copyWasmRuntime(wasmDir);
await copyLibraryBundle(wasmDir);
for (const model of MODELS) {
  await downloadModel(model);
}
console.log('==> 완료');
