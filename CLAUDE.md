# Ear Dream Core

한손 수어 인식 실시간 통역 서비스 MVP. pnpm workspace 모노레포.

- `packages/ear-dream-api` — FastAPI (Python 3.12+, uv). 의존성 추가는 `uv add`, 실행은 `uv run`.
- `packages/ear-dream-app` — Expo / React Native (TypeScript). 패키지명 `@ear-dream/app`.
- `packages/core` — 공유 API 계약 (`@ear-dream/core`). `src/generated/`는 생성물이니 직접 수정하지 말 것.

`ear-dream-api`는 Python 프로젝트라 pnpm 워크스페이스에 포함되지 않는다.

## API 계약 규칙

API 타입의 단일 진실 공급원은 `packages/ear-dream-api/app/schemas/`의 Pydantic 모델이다.
프론트에서 요청/응답 타입을 손으로 정의하지 말고 `@ear-dream/core`에서 import한다.

스키마나 라우트를 변경한 뒤에는 반드시 `pnpm generate:api-types`를 실행한다.

FastAPI는 라우트가 참조하는 모델만 OpenAPI로 내보낸다. 어떤 엔드포인트도 쓰지 않는
Pydantic 모델은 생성된 TS에 나타나지 않는다.

## 버전 고정 사항

TypeScript는 Expo SDK 57이 고정한 `~6.0.3`에 맞춰 `core`와 `app` 양쪽을 통일해 두었다.
한쪽만 올리지 말 것. `openapi-typescript`의 TS peer 예외는 `pnpm-workspace.yaml`에 명시되어 있다.

## 손 랜드마크 추출 (T-03)

`packages/ear-dream-app/src/features/recognition/landmarks/`

`useHandLandmarker` 훅이 추출을 담당하고, `types.ts`가 플랫폼 중립 계약이다.
네이티브나 서버 추론으로 전환하더라도 훅 구현만 바꾸면 되도록 격리해 두었다.
좌표는 `@ear-dream/core`의 `HandFrame`(21 × [x, y, z]) 형태로 나오므로 그대로
`RecognizeRequest.window`에 넣을 수 있다.

**handedness 라벨은 아직 실측되지 않았다.** 셀프카메라와 CSS 미러링이 겹치면 라벨이
직관과 반대로 나올 수 있다. 값은 `handedness.ts` 한 곳에 격리되어 있고
`HANDEDNESS_VERIFIED`가 `false`다. 여기가 틀리면 T-04 이후가 전부 반대로 동작하므로
추측으로 고치지 말고 실측한다. 절차는 해당 파일 주석에 있다.

**MediaPipe는 현재 브라우저 WASM 기반이라 웹에서만 동작한다.** Expo Go에서는 안내 문구가
표시되며 이는 의도된 동작이다.

`@mediapipe/tasks-vision`을 직접 import하면 라이브러리 내부의 비정적 동적 import 때문에
Metro 빌드가 실패한다. UMD 빌드를 로컬 `<script>`로 싣는 우회가 적용되어 있으니
"그냥 import하면 되는데"라며 되돌리지 말 것. 타입은 `import type`으로 유지된다.

WASM·모델 파일(약 44MB)은 커밋하지 않는다. `pnpm setup:mediapipe`로 내려받으며
`pnpm dev:web`이 자동 실행한다. CDN 직로드는 데모 현장 네트워크에 의존하게 되므로 쓰지 않는다.

## 검증

변경 후에는 레포 최상위에서 `pnpm typecheck`와 `pnpm test:api`를 돌린다.

## 미확정 항목 다루기

인식 정확도 목표치, 허용 지연 시간(ms), 후보 개수 N, 확정 방식(터치/제스처) 등은
사용자 검증과 실측 전까지 확정되지 않은 값이다. 그럴듯한 숫자를 임의로 채워 넣고
확정된 것처럼 코드나 문서에 박아두지 말 것. 값이 필요하면 프로토타입용 임시값임을
명시하고, 근거가 없다는 사실을 드러낸다.
