/**
 * MediaPipe tasks-vision 런타임 로더 — 웹 전용.
 *
 * 왜 `import { HandLandmarker } from '@mediapipe/tasks-vision'` 를 쓰지 않는가
 *
 * tasks-vision 의 ESM/CJS 빌드에는 `import(t.toString())` 처럼 인자가 정적 문자열이 아닌
 * 동적 import 가 들어 있다. Metro 는 이런 호출을 트랜스폼 단계에서 거부하고
 * "Invalid call at line 1: import(t.toString())" 로 번들 빌드를 실패시킨다.
 * 그 코드는 모듈 워커 경로의 사실상 죽은 코드지만, Metro 는 실행 여부와 무관하게 파싱 시점에 막는다.
 * 옵션으로 끌 수 없다.
 *
 * 그래서 라이브러리 본체는 번들에 넣지 않고 런타임에 <script> 로 읽는다.
 * 파일은 `pnpm setup:mediapipe` 가 public/ 에 복사해 둔 것이라 CDN 이 아니라 같은 오리진이다.
 * (CDN 직로드는 데모 현장 네트워크에 의존하게 되므로 쓰지 않는다.)
 *
 * 타입은 `import type` 으로 계속 실제 패키지에서 가져온다. 타입 전용 import 는 컴파일 시
 * 완전히 사라지므로 Metro 가 라이브러리를 볼 일이 없고, 타입 안전성은 그대로 유지된다.
 * 즉 API 형태가 바뀌면 여전히 `pnpm typecheck` 에서 잡힌다.
 */
import type { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

import { MEDIAPIPE_BUNDLE_PATH } from './config';

/** IIFE 빌드가 전역 `Vision` 에 노출하는 것 중 이 프로젝트가 쓰는 부분만. */
export interface VisionRuntime {
  FilesetResolver: typeof FilesetResolver;
  HandLandmarker: typeof HandLandmarker;
  FaceLandmarker: typeof FaceLandmarker;
}

let cached: VisionRuntime | null = null;
let pending: Promise<VisionRuntime> | null = null;

function readGlobal(): VisionRuntime | null {
  const candidate = (globalThis as { Vision?: VisionRuntime }).Vision;
  // 셋 다 확인한다. 하나라도 없으면 번들이 예상과 다른 것이므로 아래에서 명시적으로 실패시킨다.
  return candidate?.HandLandmarker && candidate.FaceLandmarker && candidate.FilesetResolver
    ? candidate
    : null;
}

export function loadVisionRuntime(): Promise<VisionRuntime> {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = new Promise<VisionRuntime>((resolve, reject) => {
    const alreadyLoaded = readGlobal();
    if (alreadyLoaded) {
      cached = alreadyLoaded;
      resolve(alreadyLoaded);
      return;
    }

    const script = document.createElement('script');
    script.src = MEDIAPIPE_BUNDLE_PATH;
    script.async = true;

    script.onload = () => {
      const runtime = readGlobal();
      if (!runtime) {
        pending = null;
        reject(
          new Error(
            `${MEDIAPIPE_BUNDLE_PATH} 를 읽었지만 Vision 전역에서 HandLandmarker/FaceLandmarker 를 찾지 못했습니다.`,
          ),
        );
        return;
      }
      cached = runtime;
      resolve(runtime);
    };

    script.onerror = () => {
      // 실패한 Promise 를 캐시하면 새로고침 없이는 재시도할 수 없다.
      pending = null;
      reject(
        new Error(
          `MediaPipe 라이브러리(${MEDIAPIPE_BUNDLE_PATH})를 불러오지 못했습니다. \`pnpm setup:mediapipe\` 를 실행했는지 확인하세요.`,
        ),
      );
    };

    document.head.appendChild(script);
  });

  return pending;
}

/**
 * 이미 로드된 런타임을 동기적으로 돌려준다. 로드 전이면 null.
 * 매 프레임 그리는 쪽(캔버스)에서 쓴다 — 프레임이 오는 시점에는 항상 로드가 끝나 있다.
 */
export function getVisionRuntime(): VisionRuntime | null {
  return cached;
}
