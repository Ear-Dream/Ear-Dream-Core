# Ear Dream Core

FastAPI + React Native 기반의 한손 수어 인식 실시간 통역 서비스

기존 수어 인식 서비스는 대부분 양손 수어를 전제로 하며, 휴대폰을 거치할 수 있는 환경에서만
제대로 동작한다. 이 프로젝트는 이동 중처럼 한 손만 자유로운 상황에서의 수어 소통을 다룬다.

- 농인 → 청인: 수어 동작을 단어 단위로 인식 → 1순위 후보로 자동 확정해 단어 누적
  (오인식은 단어를 탭해 후보 교체·삭제) → 문장 변환 → 텍스트 전달
- 청인 → 농인: 음성 인식 → 수어 영상 재생 (현재 화면 흐름만 있는 mock)

## 구성

```
packages/
  core/            // 공유 API 계약 (OpenAPI에서 생성한 TS 타입)
  ear-dream-api/   // FastAPI 서버 — 수어 단어 인식 추론, 문장 변환
  ear-dream-app/   // Expo, React Native 앱
```

수어 인식 모델의 학습·실험 코드는 별도 레포(`Ear-Dream-Model`)에 있고, 이 레포의 서버는
그 학습 결과(체크포인트)를 읽어 서빙만 한다.

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

### 모델 체크포인트

수어 인식은 형제 디렉토리의 `Ear-Dream-Model` 레포에 있는 학습 체크포인트를 경로 참조로
로드한다. 체크포인트는 이 레포에 커밋하지 않는다.

- 기본 경로: `../Ear-Dream-Model/experiments/runs/exp15_small_v2_z-off_f4/best.pt`
  (이 레포와 같은 부모 디렉토리에 `Ear-Dream-Model`을 클론해 두면 된다)
- 캘리브레이션 파일 `../Ear-Dream-Model/experiments/calibration.json`도 함께 읽는다.
  없으면 경고 로그만 남기고 보정 없이 동작한다.
- 다른 위치는 환경변수 `EAR_DREAM_MODEL_CHECKPOINT_PATH`로 지정한다.
  상대경로는 `packages/ear-dream-api` 기준이다.

체크포인트가 없어도 서버는 뜬다. 다만 `POST /api/v1/recognize`가 503을 반환하고
`GET /health`의 `model_loaded`가 `false`가 된다.

## 실행

### 전체 흐름 (API 서버 + 웹)

수어 인식은 실제로 서버 추론을 타므로, 끝까지 눌러보려면 터미널 두 개가 필요하다.

```bash
pnpm dev:api    # http://localhost:8000
```

```bash
pnpm dev:web    # 브라우저에서 앱 실행
```

- 첫 실행 시 MediaPipe WASM·모델(약 50MB — 손·얼굴·포즈)을 자동으로 내려받는다. 이후에는 건너뛴다.
- 수어 입력 화면에서 브라우저가 카메라 권한을 물으면 허용한다. 거부하면 화면 안에 안내가 뜬다.
- 수어 트랙: 단어당 버튼을 누르는 동안 동작을 캡처 → 인식 결과가 1순위 후보로 자동
  확정되어 단어 pill로 누적(pill을 탭하면 하단 시트에서 후보 교체·삭제) → 문장 변환 →
  결과 화면. 어휘는 현재 30단어다.
- 청인 트랙(구어로 시작하기)은 음성 인식이 아직 mock이라 서버 없이도 흐름을 볼 수 있다.

API 문서는 서버 실행 후 http://localhost:8000/docs 에서 볼 수 있다.

### UI만 보기 (서버 없이)

`pnpm dev:web` 하나로도 앱은 뜬다. 서버가 없으면 수어 인식 요청이 실패했다고 안내되고,
어휘·모델 정보는 "미확인"으로 표시된다.

### 앱 실행 대상

`pnpm dev:app`이 띄우는 8081 포트는 Metro 번들러이며 앱 화면이 아니다.
브라우저로 열면 JSON이 반환된다. 화면은 아래 중 하나로 확인한다.

| 대상 | 실행 | 준비물 |
| --- | --- | --- |
| 웹 브라우저 | `pnpm dev:web` | 없음 |
| 실제 기기 | QR 코드 스캔 | Expo Go 앱, 동일 Wi-Fi |
| Android 에뮬레이터 | 터미널에서 `a` | Android Studio |
| iOS 시뮬레이터 | 터미널에서 `i` | Xcode (macOS 전용) |

현재는 웹이 기본 시연 대상이다. 카메라·랜드마크 추출(손·얼굴·포즈)이 브라우저 WASM 기반이라
웹에서만 동작하고, 실기기(Expo Go)에서는 해당 화면에 안내 문구가 표시된다. 실기기는 웹 이외
화면의 레이아웃 확인과 추후 네이티브 전환 검증에 쓴다.

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
const { data, error } = await api.GET('/api/v1/vocabulary');
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
| `pnpm setup:mediapipe` | MediaPipe WASM·모델(손·얼굴·포즈) 내려받기 |

## 현재 상태

| 엔드포인트 | 상태 |
| --- | --- |
| `GET /health` | 동작 — `status`, `model_loaded`, `vocab_size` |
| `POST /api/v1/recognize` | 동작 — 랜드마크 세그먼트 → 단어 후보 top-k |
| `POST /api/v1/compose-sentence` | 동작 — 단어 열 → 규칙 기반 문장 |
| `GET /api/v1/vocabulary` | 동작 — 어휘 30단어 카탈로그 |
| `GET /api/v1/model` | 동작 — 모델·전처리·계약 정보 |
| `GET /api/v1/phrases` | 스키마만 확정, 빈 배열 반환 |

## 로드맵

기술 리스크가 큰 인식 부분을 먼저 검증하는 순서로 진행했다.

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| M0 | 카메라 + 손·얼굴·포즈 랜드마크 추출 | 완료 (웹) |
| M1 | 제한 어휘(30단어) 인식, 후보 top-N | 완료 |
| M2 | 후보 확정, 단어 누적 → 문장 변환, 텍스트 표시 | 완료 |
| M3 | 오인식 정정, 상황 문장 호출 | 부분 — 정정(후보 교체·삭제·재전송)은 됨, 상황 문장 미착수 |
| M4 | 음성 → 수어 영상 | 미착수 (화면 흐름은 mock) |
| M5 | WebRTC 양방향 세션 | 미착수 |

다음 단계로 확정된 것: 단어당 버튼 캡처를 발화 단위 촬영 + 서버 오프라인 분절(손 keypoint
정지 구간 기준)로 전환한다. 아직 구현 전이다.

인식 정확도, 허용 지연 시간, 후보 개수는 아직 확정되지 않았다. 학습 데이터셋(통제 환경)
기준 평가 수치는 실사용 환경의 정확도와 다르므로 목표치나 기대치로 사용하지 않는다.
실기기·실사용 조건의 실측이 끝나기 전까지 임의의 값을 목표치로 사용하지 않는다.
