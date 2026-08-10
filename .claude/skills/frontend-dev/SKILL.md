---
name: frontend-dev
description: "Ear Dream 앱(Expo / React Native) 프론트엔드 개발. 화면·컴포넌트 구현, 상태 관리, API 연동, 한 손 조작 UI를 담당한다. 앱 코드(packages/ear-dream-app)를 작성하거나 수정할 때 사용한다."
---

# Frontend Developer — Ear Dream 앱

`packages/ear-dream-app`(Expo / React Native)을 구현한다.
한손 수어로 소통하는 농인이 **폰을 든 채 한 손만으로** 쓰는 앱이라는 점이 모든 판단의 기준이다.

## 착수 전 확인

1. `README.md` — 구조, 실행 방법, API 계약 파이프라인
2. `CLAUDE.md` — 레포 전체 규칙
3. `packages/core/src/` — 사용 가능한 API 타입
4. http://localhost:8000/docs — 실제 엔드포인트와 응답 형태 (`pnpm dev:api` 실행 후)

## 절대 규칙: API 타입은 손으로 정의하지 않는다

이 레포에서 가장 자주 발생하고 가장 비싼 실수다. **타입 검사도 CI도 이 실수를 잡지 못한다.**
직접 정의한 타입은 컴파일이 통과하기 때문에 서버와 어긋난 사실이 런타임까지 드러나지 않는다.

```typescript
// 금지 — 서버 스키마와 조용히 어긋난다
interface PresetPhrase { id: string; category: string; text: string; }
const res = await fetch('http://localhost:8000/api/v1/phrases');

// 올바른 방법
import type { PresetPhrase } from '@ear-dream/core';
import { api } from './src/api';

const { data, error } = await api.GET('/api/v1/phrases', {
  params: { query: { category: '의료' } },
});
```

필요한 타입이 `@ear-dream/core`에 없다면 직접 만들지 말고 다음 순서로 처리한다.

1. 백엔드에 해당 필드를 Pydantic 스키마에 추가해달라고 요청
2. `pnpm generate:api-types` 실행
3. 생성된 타입을 import

서버가 다루지 않는 순수 클라이언트 상태(화면 전환, 입력 중 텍스트 등)만 앱에서 정의한다.

## 한 손 조작 (제품의 핵심 제약)

폰을 든 반대 손은 수어를 하고 있다. 두 손을 쓰는 UI는 이 제품에서 성립하지 않는다.

- 조작 요소는 **화면 하단**, 엄지가 닿는 범위에 배치한다
- 상단 모서리에 필수 조작(확정, 정정)을 두지 않는다
- 터치 타겟은 iOS 44pt / Android 48dp 이상을 지킨다
- 길게 누르기, 정밀한 드래그, 두 손가락 제스처를 요구하지 않는다
- 오인식 정정 경로는 항상 화면에 보이게 둔다 (숨은 메뉴 안에 두지 않는다)

## 접근성

주 사용자가 농인이며, 텍스트에 익숙하지 않은 사용자도 포함된다.

- 안내를 텍스트에만 의존하지 않는다. 아이콘·색·형태를 함께 쓴다
- 소리로만 전달되는 피드백을 만들지 않는다. 시각 피드백을 반드시 병행한다
- 청인에게 보여주는 텍스트는 큰 글자·고대비로 렌더링한다
- `accessibilityLabel`, `accessibilityRole`을 지정한다

## 디렉토리 구조

```
packages/ear-dream-app/
├── App.tsx                 진입점
├── src/
│   ├── api.ts              core 클라이언트 인스턴스
│   ├── components/         재사용 UI (Button, Badge, ScreenFrame ...)
│   ├── navigation/         AppNavigator — 상태 기반 화면 전환
│   ├── features/           기능 단위 묶음
│   │   ├── home/             첫 화면
│   │   ├── recognition/      카메라·랜드마크(landmarks/)·세그먼트 캡처(capture/)·
│   │   │                     인식 큐(api/)·pill 큐·후보 하단 시트
│   │   ├── transcript/       청인용 결과 표시 (+ speech/ TTS)
│   │   └── voice/            청인 트랙 — 음성 입력 화면 (STT는 mock)
│   ├── hooks/              커스텀 훅
│   └── constants/          문자열, 색상, 치수
```

상황 문장(phrases) 등 미착수 기능의 디렉토리는 미리 만들지 않는다. 필요한 시점에 만든다.

## 기술 선택

| 항목 | 방침 |
| --- | --- |
| 스타일 | React Native `StyleSheet`. Tailwind/NativeWind는 도입하지 않았다 |
| 화면 전환 | `src/navigation/AppNavigator`의 상태 기반 전환(자체 구현). `expo-router`는 미도입 — 필요해지면 팀과 결정 |
| 서버 상태 | `@ear-dream/core` 클라이언트 + `useState`/`useEffect`로 시작 |
| 전역 상태 | MVP에서는 `useState`/`useReducer`. 라이브러리는 실제로 필요해질 때 결정 |
| 환경 변수 | `EXPO_PUBLIC_` 접두사만 앱 번들에 포함된다 |

설치되지 않은 라이브러리를 전제로 코드를 쓰지 않는다. 필요하면 `npx expo install`로 SDK 호환
버전을 설치한다 (`pnpm add` 대신).

## 코드 품질 기준

| 항목 | 기준 |
| --- | --- |
| 컴포넌트 크기 | 200줄 이내, 초과 시 분리 |
| Props | 5개 이하, 초과 시 객체로 묶기 |
| 커스텀 훅 | 로직 재사용 시 훅으로 추출 |
| 로딩 상태 | 모든 비동기 작업에 로딩 UI |
| 에러 상태 | API 실패 시 사용자가 다음 행동을 할 수 있는 UI를 준다 |
| 하드코딩 문자열 | `src/constants/`로 분리 |
| 테스트 훅 | 상호작용 요소에 `testID` 지정 |

## 미확정 수치를 확정처럼 쓰지 않는다

후보 개수(N), 허용 지연 시간, 인식 정확도는 사용자 검증 전까지 정해지지 않았다.
(확정 방식은 정해졌다 — top-1 자동 확정 + pill 탭 사후 정정, 2026-08-10 pill 큐 UX 확정.)
값이 필요하면 상수로 분리하고 임시값임을 주석으로 남긴다.

```typescript
// 프로토타입 임시값. 사용자 검증 전까지 확정 아님 (3개 vs 5개 미검증)
export const CANDIDATE_COUNT = 3;
```

그럴듯한 숫자를 만들어 넣고 확정된 것처럼 코드나 문서에 남기지 않는다.

## 검증

변경 후 레포 최상위에서 실행한다.

```bash
pnpm typecheck
```

API 스키마가 바뀐 뒤라면 먼저 타입을 재생성한다.

```bash
pnpm generate:api-types
```

화면 확인은 `pnpm dev:web`(브라우저)이 기본이다. 카메라·랜드마크 추출·수어 인식은
브라우저 WASM 기반이라 현재 **웹에서만** 동작한다 — 실기기(Expo Go)는 웹 이외 화면의
레이아웃 확인용이고, 해당 화면에는 안내 문구가 뜬다.

## 팀 협업

- **백엔드(FastAPI)**: 필요한 필드·엔드포인트를 요청한다. 앱에서 타입을 만들어 우회하지 않는다
- **모델 담당**: 인식 결과 형태(`RecognitionResult`)와 지연 특성을 확인한다
- API가 아직 없으면 목업 데이터로 UI를 먼저 만들되, **타입은 `@ear-dream/core`의 것을 쓴다**

## 알려진 제약

- 손·얼굴·포즈 랜드마크 추출(MediaPipe)은 브라우저 WASM 기반이라 **웹에서만** 동작한다.
  Expo Go에서는 안내 문구가 표시되며 이는 의도된 동작이다. 네이티브 전환 시에는
  `useLandmarker` 훅 구현만 교체하도록 격리되어 있다 (CLAUDE.md 「손 · 얼굴 · 포즈
  랜드마크 추출」 절 참고)
- `@mediapipe/tasks-vision`을 직접 import하면 Metro 빌드가 실패한다 — UMD 로컬 `<script>`
  우회가 적용되어 있으니 되돌리지 말 것 (CLAUDE.md 참고)
