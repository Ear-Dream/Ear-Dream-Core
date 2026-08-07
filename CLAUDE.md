# Ear Dream Core

한손 수어 인식 실시간 통역 서비스 MVP. pnpm workspace 모노레포.

- `packages/ear-dream-api` — FastAPI (Python 3.12+, uv). 의존성 추가는 `uv add`, 실행은 `uv run`.
- `packages/ear-dream-app` — Expo / React Native (TypeScript). 패키지명 `@ear-dream/app`.
- `packages/core` — 공유 API 계약 (`@ear-dream/core`). `src/generated/`는 생성물이니 직접 수정하지 말 것.

`ear-dream-api`는 Python 프로젝트라 pnpm 워크스페이스에 포함되지 않는다.

## 에이전트와 스킬

`.claude/agents/` — 역할별 에이전트. `architect`, `frontend-dev`, `backend-dev`, `ml-dev`, `pm`.
`.claude/skills/` — `frontend-dev`, `backend-dev`의 상세 개발 규칙. 해당 파트를 건드리기 전에 읽는다.

## 설계 문서

Notion 「[열정 3팀] 이어드림(Ear-Dream)」 하위에 있다.

SRS(무엇을/왜) → 기능 명세서(무엇을 만드나) → **MVP 아키텍처 및 개발 로드맵(어떻게)** → Tasks DB(T-01~T-16)

**아래 문서와 충돌하면 「MVP 아키텍처 및 개발 로드맵」이 우선한다.** 다만 그 문서는
Vite 웹앱 + `web/`·`server/`·`ml/` 구조를 상정하고 있고, 이 레포는 Expo 모노레포다.
경로를 그대로 따르지 말고 의도를 읽어 옮긴다.

`[확인필요]` 표시 항목은 아직 미확정이다.

## 전처리는 서버에만 구현한다 (설계 결정 1)

프론트는 **가공하지 않은 랜드마크 윈도우를 그대로 전송**한다. 정규화·스케일링은
서버 Python 전처리 모듈 한 곳에서만 수행하고, 학습 코드도 같은 모듈을 import한다.

전처리가 두 벌이 되면 미세한 불일치가 정확도를 조용히 망가뜨리고(train/serve skew),
증상이 "학습은 잘 됐는데 실사용은 틀림"으로 나타나 원인 추적이 매우 어렵다.
페이로드가 커 보여도(30프레임 × 21점 × 3 ≈ 1,890 float) 반올림 + gzip이면 수 KB다.

예외: 프론트의 움직임 감지는 호출 타이밍용이므로 학습과 일치할 필요가 없다.

## API 계약 규칙

API 타입의 단일 진실 공급원은 `packages/ear-dream-api/app/schemas/`의 Pydantic 모델이다.
프론트에서 요청/응답 타입을 손으로 정의하지 말고 `@ear-dream/core`에서 import한다.

스키마나 라우트를 변경한 뒤에는 반드시 `pnpm generate:api-types`를 실행한다.

FastAPI는 라우트가 참조하는 모델만 OpenAPI로 내보낸다. 어떤 엔드포인트도 쓰지 않는
Pydantic 모델은 생성된 TS에 나타나지 않는다.

## 버전 고정 사항

TypeScript는 Expo SDK 57이 고정한 `~6.0.3`에 맞춰 `core`와 `app` 양쪽을 통일해 두었다.
한쪽만 올리지 말 것. `openapi-typescript`의 TS peer 예외는 `pnpm-workspace.yaml`에 명시되어 있다.

## 손 · 얼굴 랜드마크 추출 (T-03)

`packages/ear-dream-app/src/features/recognition/landmarks/`

`useLandmarker` 훅이 추출을 담당하고, `types.ts`가 플랫폼 중립 계약이다.
네이티브나 서버 추론으로 전환하더라도 훅 구현만 바꾸면 되도록 격리해 두었다.
손 좌표는 `@ear-dream/core`의 `HandFrame`(21 × [x, y, z]) 형태로 나오므로 그대로
`RecognizeRequest.window`에 넣을 수 있다.

**얼굴 메쉬도 같은 프레임·같은 타임스탬프로 함께 뽑는다.** 수어에서 비수지신호(눈썹·시선·
입모양·고개)는 문법 요소라 손만으로는 의문문·부정이 구분되지 않는다. 얼굴은 `DetectedFace`로
나오며 좌표 표현은 `HandFrame`과 같다. 손 선택과 얼굴 지점 부분집합 선택은 T-04 소관이다.

`LandmarkSnapshot`의 `face`는 **그 프레임의 관측값**이고, 검출을 건너뛰었거나 얼굴이 없으면
`null`이다. 오버레이가 깜빡이지 않게 직전 값을 들고 있는 `displayFace`는 **표시 전용**이다.
버퍼에 쌓거나 전송할 때 `displayFace`를 쓰면 안 된다 — 직전 값 유지는 결측치 대치이고,
대치 정책은 서버 한 곳에만 있어야 한다(설계 결정 1). T-04는 짧은 결측을 hold가 아니라
**선형 보간**으로 메우도록 지시하고 있다.

**추론 백엔드는 `delegate: 'GPU'`다.** tasks-vision의 기본값이 CPU라서 명시하지 않으면 CPU로
돈다. 개발 환경(M3 Pro/Chrome, 1280×720) 실측으로 CPU 41.5ms/프레임 vs GPU 13.2ms였다.
T-03의 산출물이 `TARGET_FPS`의 근거가 될 FPS 수치이므로, **어느 백엔드로 잰 값인지 모르면
그 기록은 쓸모가 없다.** 개발 화면 HUD가 실제 적용된 백엔드를 표시하고, GPU 생성이 실패하면
CPU로 폴백한다.

`FaceFrame`은 `types.ts`에 있고 `@ear-dream/core`에는 없다. 아직 어떤 엔드포인트도 얼굴
좌표를 받지 않기 때문이다. 실제로 전송하게 되는 시점(T-07/T-08)에 Pydantic 스키마에 넣고
`pnpm generate:api-types`로 내려받아 대체한다 — core에 손으로 정의하지 말 것.

`outputFaceBlendshapes`는 끄고 원본 메쉬를 그대로 내보낸다. blendshape은 이미 전처리라
켜는 순간 학습과 다른 두 번째 전처리 경로가 생긴다(설계 결정 1). T-04가 잡은 방향(메쉬에서
지점을 골라 좌표 그대로 사용)과도 반대다. 점 개수는 모델 구성에 따라 468 또는 478이며
개발 화면 HUD가 실제 값을 표시한다 — 문서에 단정해 박아두지 말 것.

Holistic 단일 모델은 검토 후 쓰지 않기로 했다. 손을 `leftHandLandmarks` /
`rightHandLandmarks`로 미리 갈라 주고 handedness score가 없어서, 지금 검증해야 할 좌우 라벨이
모델 안으로 숨는다. 쓰지 않는 포즈 모델도 함께 지고 간다.

**handedness 라벨은 아직 실측되지 않았다.** 셀프카메라와 CSS 미러링이 겹치면 라벨이
직관과 반대로 나올 수 있다. 값은 `handedness.ts` 한 곳에 격리되어 있고
`HANDEDNESS_VERIFIED`가 `false`다. 여기가 틀리면 T-04 이후가 전부 반대로 동작하므로
추측으로 고치지 말고 실측한다. 절차는 해당 파일 주석에 있다.

**MediaPipe는 현재 브라우저 WASM 기반이라 웹에서만 동작한다.** Expo Go에서는 안내 문구가
표시되며 이는 의도된 동작이다.

`@mediapipe/tasks-vision`을 직접 import하면 라이브러리 내부의 비정적 동적 import 때문에
Metro 빌드가 실패한다. UMD 빌드를 로컬 `<script>`로 싣는 우회가 적용되어 있으니
"그냥 import하면 되는데"라며 되돌리지 말 것. 타입은 `import type`으로 유지된다.

WASM·모델 파일(실측 약 45MB — WASM 약 34MB + 손 7.5MB + 얼굴 3.6MB)은 커밋하지 않는다.
`pnpm setup:mediapipe`로 내려받으며 `pnpm dev:web`이 자동 실행한다. 파일 단위로 존재를
확인하므로 손 모델만 받아둔 기존 환경에서는 얼굴 모델만 추가로 받는다.
CDN 직로드는 데모 현장 네트워크에 의존하게 되므로 쓰지 않는다.

## 검증

변경 후에는 레포 최상위에서 `pnpm typecheck`와 `pnpm test:api`를 돌린다.

## 현재 진행 상황

레포 기반과 T-03(손·얼굴 랜드마크 추출)까지 완료. 다음은 T-08(윈도우 버퍼 + RecognizerClient).

| 항목 | 상태 |
| --- | --- |
| 모노레포·CI·API 계약 파이프라인 | 완료 |
| T-03 손·얼굴 랜드마크 추출 | 완료 (웹) |
| T-02 카메라 프리뷰 | **부분** — 획득·에러·미러링·세로 구도 요청은 됨(데스크톱 웹캠은 하드웨어가 가로라 가로로 응답할 수 있음 — 실기기 확인 필요). **가이드 오버레이 없음** |
| `/recognize`, `/phrases` | 스켈레톤. 빈 응답 |
| 모델 | 미착수 |

**사람이 직접 해야 하는 미측정 항목** (에이전트가 대신할 수 없다)

- handedness 라벨 실측 — `HANDEDNESS_VERIFIED`가 `false`다
- FPS 실측 — 설계 문서의 `TARGET_FPS` 확정 근거.
  개발 화면에서 얼굴 검출을 껐다 켜서 **손만 / 손+얼굴** 두 경우를 각각 기록한다.
  얼굴 때문에 체감 지연이 생기면 `FACE_DETECT_EVERY_N_FRAMES`를 올린다(현재 1 = 매 프레임,
  튜닝값이 아니라 미측정을 뜻하는 기본값)
- 실기기 프레이밍 (왼손 그립, 서서, 팔 피로도) — **왼손 그립 자세에서 얼굴이 프레임에
  들어오는지** 포함. 카메라가 얼굴보다 아래를 향하면 T-02 가이드 오버레이 위치를 조정해야 한다

**설계 문서와 현재 스키마의 차이** (T-08 전에 맞춰야 함)

- **`RecognizeRequest`가 지금 데이터를 담지 못한다.** 현재 계약은 프레임당 손 하나
  (`window: list[HandFrame]`)인데, 손 선택은 T-04에서 **서버가** 한다. 즉 요청은 양손 +
  handedness 라벨/score + 얼굴 + 프레임별 타임스탬프 + `sourceWidth`/`sourceHeight`를 실어야
  한다. 필드 추가가 아니라 스키마 재설계에 가깝다. **T-08 코드를 쓰기 전에 스키마부터 고치고
  `pnpm generate:api-types`를 돌린다.**
  - 해상도가 필요한 이유: MediaPipe 정규화 좌표는 x를 너비로, y를 높이로 나눈다. x·y를 섞는
    모든 거리 계산이 종횡비에 의존하므로, T-02의 세로 구도 수정이 들어가면 그 전에 모은
    학습 데이터의 특징값이 통째로 이동한다.
- **얼굴 페이로드 크기.** 설계 결정 1의 "수 KB" 근거는 손만 기준(30×21×3)이다. 얼굴 원본을
  더하면 30×478×3 ≈ 43,020 float로 23배가 된다. 전량 전송할지, T-04가 이미 요구한 얼굴 지점
  목록을 `/v1/model`로 내려받아 잘라 보낼지 **T-05 시작 전에** 정해야 한다(목록이 바뀌면 재학습).
- `RecognizeRequest`에 `fps?: number` 없음
- 윈도우 길이 불일치 시 422로 거절하는 검증 없음
- `/health`가 `{ status }`만 반환. 문서는 `{ status, modelLoaded, vocabSize }`

## 미확정 항목 다루기

인식 정확도 목표치, 허용 지연 시간(ms), 후보 개수 N, 확정 방식(터치/제스처) 등은
사용자 검증과 실측 전까지 확정되지 않은 값이다. 그럴듯한 숫자를 임의로 채워 넣고
확정된 것처럼 코드나 문서에 박아두지 말 것. 값이 필요하면 프로토타입용 임시값임을
명시하고, 근거가 없다는 사실을 드러낸다.
