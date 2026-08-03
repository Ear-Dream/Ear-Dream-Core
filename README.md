# Ear Dream Core

한손 수어 인식 실시간 통역 서비스 (MVP) 모노레포.

기존 수어 인식 서비스는 대부분 양손 수어를 전제로 해서, 휴대폰을 거치대에 세워둘 수 있는
상황에서만 제대로 동작한다. 이동 중처럼 한 손으로 휴대폰을 들고 있어야 하는 일상적인
상황에서는 쓰기 어렵다.

이 프로젝트는 **거치대 없이 한 손만으로도** 수어 소통이 가능하게 하는 것을 목표로 한다.

- 농인 → 청인: 한손 수어 인식 → 후보 단어 제시 → 확정 → 텍스트로 전달
- 청인 → 농인: 음성 인식 → 수어 영상으로 변환

정확도를 과시하는 것보다 **빠른 후보 제시와 낮은 정정 비용**이 핵심이다.
오인식했을 때 즉시 고칠 수 없다면 메모장으로 필담하는 것보다 나을 게 없기 때문이다.

## 구조

```
packages/
  core/              API 계약 공유 패키지 — FastAPI 스키마에서 자동 생성된 TS 타입 + 클라이언트
  ear-dream-api/     수어 인식 추론·데이터 서버 (FastAPI, Python 3.12+, uv)
  ear-dream-app/     모바일 앱 (Expo / React Native, TypeScript)
scripts/
  generate-api-types.sh   FastAPI 스키마 -> TS 타입 동기화
```

## 사전 준비 (최초 1회)

```bash
brew install node pnpm uv
```

## 설치

```bash
pnpm install && (cd packages/ear-dream-api && uv sync)
```

## 실행

API 서버 (터미널 1):

```bash
pnpm dev:api
```

모바일 앱 (터미널 2):

```bash
pnpm dev:app
```

Expo가 QR 코드를 띄우면 휴대폰의 Expo Go 앱으로 스캔하거나, 터미널에서 `i`(iOS 시뮬레이터) / `a`(Android)를 누른다.

### 실제 휴대폰에서 테스트할 때

앱의 API 주소 기본값은 `http://localhost:8000`이다. **실제 휴대폰에서는 `localhost`가 휴대폰 자신을 가리키므로 API 서버에 연결되지 않는다.** 개발 PC의 LAN IP를 지정해야 한다.

```bash
# 개발 PC의 IP 확인 (macOS)
ipconfig getifaddr en0
```

확인한 IP로 `packages/ear-dream-app/.env` 파일을 만든다:

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:8000
```

API 서버도 외부 접속을 받도록 띄운다:

```bash
cd packages/ear-dream-api && uv run fastapi dev app/main.py --host 0.0.0.0
```

iOS 시뮬레이터만 쓴다면 `localhost` 기본값 그대로 동작한다.

## API 계약 공유 방식 (중요)

**API 스펙의 단일 진실 공급원은 FastAPI의 Pydantic 스키마다.** 프론트에서 타입을 손으로 다시 쓰지 않는다.

```
packages/ear-dream-api/app/schemas/*.py   (Pydantic)
        │
        │  uv run python scripts/export_openapi.py
        ▼
packages/core/openapi.json
        │
        │  openapi-typescript
        ▼
packages/core/src/generated/schema.ts  ──>  ear-dream-app 에서 import
```

백엔드에서 스키마나 엔드포인트를 바꿨다면 다음 한 줄을 실행한다:

```bash
pnpm generate:api-types
```

그러면 앱 쪽 타입이 갱신되고, 계약이 깨진 부분은 `pnpm typecheck`에서 컴파일 에러로 잡힌다.

앱에서 API를 호출할 때는 `packages/core`의 클라이언트를 쓴다 (경로·요청·응답이 전부 타입 체크된다):

```typescript
import { api } from './src/api';

const { data, error } = await api.GET('/api/v1/phrases', {
  params: { query: { category: '의료' } },
});
```

`openapi.json`과 `src/generated/`는 생성물이라 git에 커밋하지 않는다. 설치 후 `pnpm generate:api-types`를 한 번 실행하면 만들어진다.

## 검사

전부 레포 최상위에서 실행한다.

```bash
pnpm typecheck   # 전체 TS 타입 검사 (core + app)
pnpm test:api    # API 테스트
pnpm lint:api    # API 린트
```

## 현재 구현 상태

레포 뼈대만 있는 단계다. 엔드포인트는 스키마만 확정되어 있고 빈 응답을 돌려준다.

| 엔드포인트 | 상태 |
| --- | --- |
| `GET /health` | 동작 |
| `POST /api/v1/recognize` | 스켈레톤 (빈 후보 반환, 모델 미연결) |
| `GET /api/v1/phrases` | 스켈레톤 (빈 배열 반환, 데이터 미연결) |

## 개발 순서

기술 리스크가 가장 큰 인식 부분을 먼저 검증하는 순서로 쌓아 올린다.

| 단계 | 내용 | 산출물 |
| --- | --- | --- |
| M0 | 카메라 + 손 랜드마크 추출 | 화면에 손 21점 오버레이 |
| M1 | 제한 어휘 인식 | 동작 → 후보 단어 top-N |
| M2 | 후보 확정 + 결과 표시 | 수어 → 후보 → 확정 → 텍스트 **(핵심 데모)** |
| M3 | 정정 + 상황 문장 | 재동작 / 직접 입력, 자주 쓰는 문장 호출 |
| M4 | 음성 → 수어 | 청인 발화를 수어 영상으로 재생 |
| M5 | 양방향 세션 | WebRTC 실시간 영상통화 통합 |

M2까지 완성되면 단일 기기에서 핵심 가설("한 손만으로 소통 가능한가")을 데모할 수 있다.
초기 어휘는 5~10개 수준으로 제한해서 시작한다.

> M0의 손 랜드마크 추출(MediaPipe)은 네이티브 모듈이 필요해 Expo Go에서는 동작하지 않는다.
> 그 시점에 development build(`npx expo prebuild`)로 전환해야 한다.

인식 정확도·허용 지연 시간·후보 개수 같은 수치는 아직 확정되지 않았다.
사용자 검증과 실측으로 정하기 전까지 임의의 값을 목표치로 박아두지 않는다.
