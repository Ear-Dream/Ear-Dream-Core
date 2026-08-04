# Ear Dream Core

FastAPI + React Native 기반의 한손 수어 인식 실시간 통역 서비스 

기존 수어 인식 서비스는 대부분 양손 수어를 전제로 하며, 휴대폰을 거치할 수 있는 환경에서만
제대로 동작한다. 이 프로젝트는 이동 중처럼 한 손만 자유로운 상황에서의 수어 소통을 다룬다.

- 농인 → 청인: 수어 인식 → 후보 단어 제시 → 확정 → 텍스트 전달
- 청인 → 농인: 음성 인식 → 수어 영상 재생

## 구성

```
packages/
  core/            // API config
  ear-dream-api/   // FastAPI 서버 — 수어 인식 추론, 문장 데이터
  ear-dream-app/   // Expo, React Native 앱
```

## 요구사항

- Node.js 20 이상
- Python 3.12 이상
- pnpm, uv

macOS ([Homebrew](https://brew.sh))

```bash
brew install node pnpm uv
```

Windows ([winget](https://learn.microsoft.com/windows/package-manager/winget/))

```powershell
winget install OpenJS.NodeJS astral-sh.uv
npm install -g pnpm
```

## 설치

```bash
pnpm install
cd packages/ear-dream-api
uv sync
```

## 실행

터미널 두 개가 필요하다.

```bash
pnpm dev:api    # http://localhost:8000
```

```bash
pnpm dev:app    # Metro 번들러
```

API 문서는 서버 실행 후 http://localhost:8000/docs 에서 볼 수 있다.

### 앱 실행 대상

`pnpm dev:app`이 띄우는 8081 포트는 Metro 번들러이며 앱 화면이 아니다.
브라우저로 열면 JSON이 반환된다. 화면은 아래 중 하나로 확인한다.

| 대상 | 실행 | 준비물 |
| --- | --- | --- |
| 웹 브라우저 | `pnpm dev:web` | 없음 |
| 실제 기기 | QR 코드 스캔 | Expo Go 앱, 동일 Wi-Fi |
| Android 에뮬레이터 | 터미널에서 `a` | Android Studio |
| iOS 시뮬레이터 | 터미널에서 `i` | Xcode (macOS 전용) |

웹은 레이아웃과 API 연동 확인에 쓴다. 카메라와 수어 인식은 웹에서 동일하게 동작하지 않으므로
실제 기기로 검증한다.

iOS 시뮬레이터는 macOS에서만 사용할 수 있다. Xcode 설치 후 아래를 한 번 실행한다.
Command Line Tools만으로는 동작하지 않는다.

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Windows에서는 iOS 확인이 필요할 때 실제 기기의 Expo Go를 사용한다.

### API 주소 설정

앱은 `EXPO_PUBLIC_API_URL`로 API 서버를 찾는다. 실행 대상에 따라 주소가 다르다.

| 실행 대상 | 주소 |
| --- | --- |
| 웹 브라우저, iOS 시뮬레이터 | 기본값 (`http://localhost:8000`) |
| Android 에뮬레이터 | `http://10.0.2.2:8000` |
| 실제 기기 | `http://<PC의 LAN IP>:8000` |

기본값이 아닌 경우 `packages/ear-dream-app/.env`에 설정한다. `.env.example` 참고.

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:8000
```

실제 기기에서는 API 서버도 외부 접속을 허용해야 한다.

```bash
cd packages/ear-dream-api
uv run fastapi dev app/main.py --host 0.0.0.0
```

PC의 LAN IP 확인은 macOS에서 아래를 쓴다.

```bash
ipconfig getifaddr en0
```

Windows에서는 아래 출력의 IPv4 주소를 사용한다.

```powershell
ipconfig
```

## API 타입 생성

API 타입의 단일 진실 공급원은 FastAPI의 Pydantic 스키마다. 프론트에서 요청/응답 타입을
직접 정의하지 않는다.

```
ear-dream-api/app/schemas/*.py  ──(OpenAPI)──▶  core/openapi.json
                                                     │
                                        (openapi-typescript)
                                                     ▼
                                        core/src/generated/schema.ts
```

스키마나 라우트를 변경한 뒤 실행한다.

```bash
pnpm generate:api-types
```

계약이 깨진 부분은 `pnpm typecheck`에서 컴파일 에러로 드러난다.

앱에서는 `@ear-dream/core`의 클라이언트를 사용한다. 경로, 요청, 응답이 모두 타입 검사된다.

```typescript
const { data, error } = await api.GET('/api/v1/phrases', {
  params: { query: { category: '의료' } },
});
```

`openapi.json`과 `src/generated/`는 생성물이므로 커밋하지 않는다. 설치 후 한 번 생성하면 된다.

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `pnpm dev:api` | API 서버 |
| `pnpm dev:app` | 앱 (QR / 시뮬레이터 / 에뮬레이터) |
| `pnpm dev:web` | 앱 (브라우저) |
| `pnpm typecheck` | TypeScript 타입 검사 |
| `pnpm test:api` | API 테스트 |
| `pnpm lint:api` | API 린트 |
| `pnpm generate:api-types` | API 타입 생성 |

## 현재 상태

| 엔드포인트 | 상태 |
| --- | --- |
| `GET /health` | 동작 |
| `POST /api/v1/recognize` | 스키마만 확정, 빈 후보 반환 |
| `GET /api/v1/phrases` | 스키마만 확정, 빈 배열 반환 |

## 로드맵

기술 리스크가 큰 인식 부분을 먼저 검증하는 순서로 진행한다.

| 단계 | 내용 |
| --- | --- |
| M0 | 카메라 + 손 랜드마크 추출 |
| M1 | 제한 어휘 인식, 후보 top-N |
| M2 | 후보 확정, 텍스트 표시 |
| M3 | 오인식 정정, 상황 문장 호출 |
| M4 | 음성 → 수어 영상 |
| M5 | WebRTC 양방향 세션 |

M2까지 완성되면 단일 기기에서 핵심 가설을 검증할 수 있다. 초기 어휘는 5~10개로 제한한다.

M0의 손 랜드마크 추출(MediaPipe)은 네이티브 모듈을 필요로 하므로 Expo Go에서 동작하지 않는다.
해당 시점에 development build(`npx expo prebuild`)로 전환한다.

인식 정확도, 허용 지연 시간, 후보 개수는 아직 확정되지 않았다. 사용자 검증과 실측 전까지
임의의 값을 목표치로 사용하지 않는다.
