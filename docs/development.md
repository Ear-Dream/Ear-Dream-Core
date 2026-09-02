# 개발 가이드

실기기 확인, 앱 실행 대상, API 계약 파이프라인, 모델 번들 배포. 설치와 기본 실행은
[README](../README.md)에 있다.

## 실기기(모바일 웹)

실기기 브라우저는 localhost 밖에서 `getUserMedia`에 https를 요구한다. 웹과 API를 한
오리진으로 묶어 서빙하고, https는 터널이 씌운다 — 인증서를 폰에 설치할 필요가 없어
링크만 보내면 된다. 한 오리진이라 mixed content도 CORS도 없다.

```bash
pnpm build:web-mobile
```

터미널 셋이다.

```bash
pnpm dev:api          # API (8000)
```

```bash
pnpm serve:mobile     # 웹 + API 프록시 (8080, 평문 — 터널이 https를 씌운다)
```

```bash
ngrok http 8080
```

ngrok이 출력하는 https 주소를 폰 브라우저에서 연다.

### 링크를 나눠 줄 때

터널 주소는 인터넷에 노출된 상태다. 링크를 아는 사람만 들어오게 하려면 시크릿을 준다.

```bash
node scripts/serve-mobile.mjs --port 8080 --token $(openssl rand -hex 8)
```

공유할 주소는 `https://<ngrok 주소>/?k=<시크릿>`이다. 한 번 열면 쿠키로 바뀌고 주소에서
시크릿이 지워지므로 이후 이동에는 붙일 필요가 없다. API 문서(`/docs`)는 기본으로
프록시하지 않는다 — 폰에서 봐야 하면 `--docs`를 준다.

무료 플랜은 재시작마다 주소가 바뀐다. 계정에 static domain을 하나 배정받아
`ngrok http --url=<도메인> 8080`으로 띄우면 링크를 다시 뿌리지 않아도 된다.

첫 방문은 약 19MB(폰트·WASM·모델)를 받고 그 뒤로는 캐시된다. 인식은 단어당 약 0.9MB를
올린다 — 사람이 몇 명 붙는지에 따라 터널 대역폭 한도를 먼저 확인하는 게 좋다.

### 실기기 개발 화면

FPS·단계별 처리 시간·실제 delegate는 홈의 "개발용: 랜드마크 확인 화면"에서 볼 수 있다.
프로덕션 번들에서는 숨으므로 아래로 연다.

```bash
EXPO_PUBLIC_LANDMARK_DEV=1 pnpm build:web-mobile
```

이미 만든 빌드는 `?dev=1`을 붙여 열어도 된다.

## UI만 보기 (서버 없이)

`pnpm dev:web` 하나로도 앱은 뜬다. 서버가 없으면 수어 인식 요청이 실패했다고 안내되고,
어휘·모델 정보는 "미확인"으로 표시된다.

## 앱 실행 대상

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

## API 주소 설정

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

API 타입을 건너뛴 채로 `pnpm typecheck`를 돌리면
`Cannot find module './generated/schema'`로 실패한다. 타입은 번들 시점에 지워지므로
`pnpm dev:web` 자체는 그래도 돈다.

앱에서는 `@ear-dream/core`의 클라이언트를 사용한다. 경로, 요청, 응답이 모두 타입 검사된다.

```typescript
const { data, error } = await api.GET('/api/v1/vocabulary');
```

`openapi.json`과 `src/generated/`는 생성물이므로 커밋하지 않는다. 설치 후 한 번 생성하면 된다.

## 모델 번들

수어 인식 모델은 대용량 바이너리라 커밋하지 않는다(`var/`는 .gitignore). `pnpm setup`이
설치해 두지만 따로 다시 만들 수도 있다.

```bash
pnpm setup:model-bundle
```

`packages/ear-dream-api/var/models/single-observed-300-v2/`에 생긴다. 이미 있으면
건너뛰고, 다시 만들려면 `--force`를 붙인다.

**학습 레포를 클론해 둘 필요가 없다.** 이 명령은 공개 학습 저장소
(`Ear-Dream/Ear-Dream-Benchmarks`)의 **고정 커밋**에서 TorchScript(약 26MB)를 내려받아
번들을 만든다. 참조를 커밋 SHA로 박아 두므로 어느 기계에서 언제 돌려도 같은 산출물이
나오고, 별도의 릴리스 업로드 단계가 없다.

- 구성: `model_torchscript.pt`(TorchScript 가중치) + `release.json`(계약·캘리브레이션
  메타). `live_debias.npy`(라이브 편향 벡터)는 **번들에 따라 있고 없다** — 편향은
  모델별로 추정하는 값이라 추정하지 않은 번들은 싣지 않는다(현재 번들이 그렇다)
- `release.json`의 `source`에 레포·커밋 SHA·산출물 sha256이 남는다 — 어느 가중치를
  서빙 중인지 번들만 보고 확인할 수 있다
- 로드 게이트: `release.json`의 `feature_version`이 서버 전처리 계약과 다르거나,
  `class_labels`가 어휘 데이터와 어긋나거나, `serving.interface`가 서버가 모르는
  값이면 로드를 거부한다 — 구모델+신전처리 조합, 조용한 전량 오답, 모르는 호출
  규약으로의 추론을 막는 장치다
- `serving.interface`가 **forward 호출 규약을 밝힌다**(`single_observed_v1`).
  로더가 모르는 값이면 로드를 거부한다 — 잘못된 인자 수로 forward 하는 사고를 막는다
- 다른 위치는 환경변수 `EAR_DREAM_MODEL_BUNDLE_DIR`로 지정한다
  (상대경로는 `packages/ear-dream-api` 기준)

**번들이 없어도 서버는 뜬다.** `POST /api/v1/recognize`만 503이고
`GET /health`의 `model_loaded`가 `false`가 된다 — 문장 변환·아바타·음성 흐름은 그대로
돈다. 즉 수어 인식을 제외한 전 구간은 번들 없이 확인할 수 있다.

### 다른 모델·다른 커밋으로 바꿀 때

빌드 스크립트를 직접 부른다. **레포 루트에서** 서브셸로 감싸면 현재 위치가 바뀌지 않는다.

```bash
(cd packages/ear-dream-api && uv run python scripts/build_single_observed_bundle.py --run final_all_people_deployment)
```

```bash
(cd packages/ear-dream-api && uv run python scripts/build_single_observed_bundle.py --ref main)
```

- `--run` — 어느 학습 산출물로 번들을 만들지 (기본 `kh_partial_deployment` = 현재 서빙하는
  4인 person-adapted / `final_all_people_deployment` = 이전 세대 3인 모델, 비교용)
- `--ref` — 학습 레포의 커밋 SHA·브랜치·태그. **새 모델을 채택하면 스크립트의
  `DEFAULT_REF`를 새 SHA로 갱신한다** (브랜치로 두면 같은 명령이 시점에 따라 다른
  가중치를 받는다)
- `--source` — 로컬 체크아웃 경로. 아직 push하지 않은 산출물을 시험할 때만 쓴다
- `--partition` — 클래스 인덱스 대조 파일(경로/URL)

⚠️ `single_observed_hand_300`은 클래스 인덱스 정본(`data/organized300_v1/`)이 학습
레포의 `.gitignore` 대상이라 올라와 있지 않고, 그래서 **대조 없이 빌드된다**. 올라오면
`--partition`으로 넘기면 자동 대조된다. 없을 때의 확인 방법은 라벨된 REAL09로 채점해
보는 것이다 — 순서가 맞으면 ~89%, 어긋나면 ~0.3%(우연)라 판정이 명확하다.

`vocab300.json`은 **이 스크립트가 쓰지 않는다** — 어휘가 이미 커밋돼 있고 인덱스가
맞는지 확인만 한다. 어휘를 새로 만드는 것은 `scripts/build_spoter300_bundle.py` 의 몫이다
(⚠️ 그 스크립트는 학습 레포가 **로컬에 있다고 가정**하는 옛 방식이라, 어휘를 다시 만들
일이 아니면 쓰지 않는다).

⚠️ **모델을 다른 세대로 바꾸면 `preprocess_spoter.AR_TRAIN` 도 함께 봐야 한다.** 그 값은
모델의 학습 좌표 관례라 모델마다 다르고, 안 맞추면 에러 없이 정확도만 무너진다.
