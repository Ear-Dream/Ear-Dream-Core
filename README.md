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

수어 인식 모델의 학습·실험 코드는 별도 레포에 있고, 이 레포의 서버는 그 학습
산출물(모델 번들)을 읽어 서빙만 한다.

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

### 모델 번들

수어 인식 모델은 로컬 번들 디렉토리 `packages/ear-dream-api/var/models/spoter300-pilot/`
에서 로드한다. 번들은 커밋하지 않으며(`var/`는 .gitignore), 학습 산출물에서
`scripts/build_spoter300_bundle.py`로 생성한다.

- 구성: `model_torchscript.pt`(TorchScript 가중치) + `release.json`(계약·캘리브레이션
  메타) + `live_debias.npy`(라이브 편향 벡터 — 없으면 경고 후 보정 없이 동작)
- 로드 게이트: `release.json`의 `feature_version`이 서버 전처리 계약과 다르거나,
  `class_labels`가 어휘 데이터와 어긋나면 로드를 거부한다 — 구모델+신전처리 조합이나
  조용한 전량 오답을 막는 장치다
- 다른 위치는 환경변수 `EAR_DREAM_MODEL_BUNDLE_DIR`로 지정한다
  (상대경로는 `packages/ear-dream-api` 기준)

번들이 없어도 서버는 뜬다. 다만 `POST /api/v1/recognize`가 503을 반환하고
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
  결과 화면. 어휘는 현재 300단어다.
- 청인 트랙(구어로 시작하기)은 음성 인식이 아직 mock이라 서버 없이도 흐름을 볼 수 있다.

**터미널 두 개가 전부다.** 수어 인식 모델은 API 서버에 in-process로 로드되므로 별도
프로세스가 없고, 문장 변환 LLM은 켜지면 문장을 더 다듬어 주는 선택 단계다 — 안 띄우면
규칙 경로로 내려갈 뿐 흐름은 그대로 돈다 (「단어열 → 문장 변환」 참고).

API 문서는 서버 실행 후 http://localhost:8000/docs 에서 볼 수 있다.

### 실기기 모바일 웹

**모바일은 별도 네이티브 모듈 없이 웹으로 테스트한다.** 랜드마크 추출을 네이티브
MediaPipe로 옮기는 방안은 검토 후 채택하지 않았다 — 아래 「모바일을 네이티브로 만들지
않은 이유」 참고.

문제는 실기기 브라우저가 localhost 밖에서 `getUserMedia`에 **https를 요구**한다는 것이다.
게다가 페이지가 https인데 API가 http면 mixed content로 요청이 통째로 막힌다. 그래서
**웹과 API를 한 오리진으로 묶는다** — 인증서가 하나로 끝나고 CORS도 사라진다.

```bash
pnpm build:web-mobile
```

`EXPO_PUBLIC_API_URL`을 비운 채 내보내므로 앱이 API를 **상대경로**로 호출한다.
`public/mediapipe`(약 55MB)도 함께 들어간다.

그 다음 방식이 둘로 갈린다. **둘 다 아래 한 서버 위에서 돈다.**

#### A. LAN + 로컬 인증서 (권장 — 현장 네트워크에 의존하지 않는다)

```bash
brew install mkcert && mkcert -install
```
```bash
pnpm setup:https-cert
```
```bash
pnpm serve:mobile
```

`mkcert -install`은 이 기계의 트러스트 스토어에 로컬 CA를 넣는다(시스템 설정 변경이라
직접 실행해야 한다). 폰에서 경고 없이 열려면 그 **루트 CA를 폰에도 한 번 설치**한다 —
`pnpm setup:https-cert`가 CA 파일 경로와 iOS/Android 설치 절차를 출력한다.
iOS는 프로파일 설치 후 **설정 > 일반 > 정보 > 인증서 신뢰 설정에서 전체 신뢰를 켜는
마지막 단계**를 빼먹으면 계속 경고가 뜬다.

⚠️ npm에 같은 이름의 다른 패키지(`mkcert`)가 있다. `mkcert -CAROOT`가 경로를 출력해야
FiloSottile 쪽이다. npm 패키지가 PATH에 먼저 잡혀 있으면 스크립트가 그렇다고 알려준다.

#### B. 터널 (인증서 설치 없이 — 인터넷·외부 서비스에 의존)

```bash
node scripts/serve-mobile.mjs --port 8080
```
```bash
ngrok http 8080
```

ngrok이 준 https 주소를 폰에서 연다. 인증서 작업이 전혀 없는 대신 **로컬 서버가 공개
인터넷에 노출**되고 현장 네트워크에 의존한다. CDN 직로드를 쓰지 않는 것과 같은 이유로
시연에는 A를 권한다.

#### 서버

```bash
pnpm dev:api          # 터미널 1 — API (8000)
pnpm serve:mobile     # 터미널 2 — 웹 + API 프록시 (8443, https)
```

`scripts/serve-mobile.mjs`는 `dist/`를 서빙하고 `/api`·`/health`·`/docs`를 API로
프록시한다. 업로드가 세그먼트당 수 MB라 버퍼링 없이 스트리밍으로 넘긴다.
`--api`로 API 주소를, `--port`로 포트를 바꿀 수 있다.

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

## 인식 모델과 서빙 파이프라인

### 모델 아키텍처

**SPOTER-208** — 수어 인식용 Transformer 인코더 분류기. 어휘 300단어(AI Hub 일상
고빈도 핵심단어), TorchScript로 서빙한다.

- 입력: 프레임당 **208차원 특징 × 최대 256프레임**. 좌표는 **x·y만 쓴다**
  (z는 추출기 세대 간 분포가 달라 신뢰할 수 없음이 실측으로 확인돼 제외)
- 208차원 구성 (전처리 계약 `spoter2_mp_xy_v1`):
  - pose 25점×2 — 어깨 중점 원점, 어깨거리 스케일의 global 정규화 (위치·움직임 담당)
  - 오른손·왼손 각 21점×2 — square bbox → [-1,1] local 정규화 (손 모양만 담당,
    위치·크기 제거)
  - 얼굴 37점×2 — 478점 메쉬(홍채 포함)에서 서브셋 선택, local 정규화 (비수지신호)
- 출력: 300클래스 확률. temperature scaling(번들 값) 후 임계 미달이면 `rejected`

### 서빙 파이프라인 (요청 → 후보)

```
raw 아카이빙 → 손 좌우 배정(포즈 손목 기하 매칭) → 30fps 최근접 리샘플
→ 라이브 도메인 보정(아래) → 정규화·특징 추출 [T,208] → TorchScript 추론
→ temperature → 로짓 편향 제거 → reject 임계 → top-4 후보
```

### 적용된 라이브 도메인 보정

학습 데이터(스튜디오 16:9 촬영)와 실사용 입력(휴대폰 셀피 세로)의 분포 차이를
서빙 입력을 학습 분포 쪽으로 사영해 좁힌다. 실측 근거와 함께 도입됐고, 수치는
전부 **재학습·재캘리브레이션 전까지의 임시값**이다 (`app/core/config.py` 주석 참조).

| 보정 | 내용 | 근거 |
| --- | --- | --- |
| 종횡비(AR) 보정 | `x ← x × AR입력/(16/9)` — 세로 캡처 좌표를 16:9 학습 관례로 사영 | 세로 왜곡만으로 top-1 98→62% 붕괴 실측 |
| y축 기하 보정 | `y ← y × 1.205` — 셀피 근접 원근으로 몸통 비례가 눌리는 갭 보정 | 어깨-엉덩이 비율 스튜디오/라이브 실측 차 |
| 로짓 편향 제거 | log-softmax에서 편향 벡터(α=1.0) 차감 — 도메인 이동이 만든 특정 단어 과호출 억제 | 라벨 없는 실사용 아카이브로 추정 |
| reject 임계 0.15 | 라이브 conf 분포 기준 임시 하향 (스튜디오 기준 0.5는 라이브 정답도 전량 거부) | 라벨된 라이브 클립 임계 곡선 |

이 밖에 검토 후 **기각된** 접근(추출기 통일, 결측 보간, 미러링, 스무딩, TTA 등)과
그 근거는 모델 레포의 가설 원장 문서에 기록돼 있다.

### 모바일을 네이티브로 만들지 않은 이유

랜드마크 추출을 네이티브 MediaPipe로 옮기는 방안을 검토했고, **채택하지 않았다.**

- **필요가 없다.** 아카이브 실측상 실기기 세로 캡처(720×1280, GPU delegate)가 이미
  대부분이고, 라벨된 실기기 클립 41개로 현재 서빙의 보정 상수를 맞춘 상태다. 실기기
  모바일 웹 경로는 작동이 이미 증명돼 있다. 남은 장애물은 https 서빙 하나였고 위에서 닫았다
- **미측정 항목이 전부 추출기와 무관하다.** FPS·프레이밍(어깨 프레임 인)·그립손 엄지
  도달성·팔 피로도는 인체공학·구도 항목이라 웹으로 다 측정된다
- **라이브러리가 없다.** 서버가 요구하는 얼굴 **478점**(홍채 468·473을 전처리가 실제로
  쓴다 — 468점은 422로 거절)을 손 21×2 + 포즈 33과 함께 내보내는 RN 라이브러리는 조사
  결과 하나뿐이었고, 그마저 Android 전용 · 사용자 0 · 이미 폐기된 VisionCamera v4 API
  타깃이라 최신 환경에서 빌드되지 않는다. 직접 래핑하면 iOS/Android 양쪽 네이티브 코드가
  필요하고 그중 상당 부분이 회전·미러링·좌표계 디버깅이다
- **가장 큰 이유 — 보정 상수가 추출기에 묶여 있다.** `live_y_scale`·`debias_alpha`
  (+`live_debias.npy`)·`reject_threshold`는 전부 **브라우저 tasks-vision으로 찍은 라이브
  데이터**에 맞춘 값이다. 추출기를 바꾸면 모델은 그대로여도 이 세 값의 근거가 조용히
  무효화된다. 특히 debias는 클래스별 편향을 빼는 연산이라 갭 방향이 바뀌면 보정이 아니라
  **새 편향 주입**이 된다. 증상이 "모델은 정상인데 임계만 이상함"이라 원인 추적이 어렵다.
  웹과 네이티브가 서로 다른 상수를 요구하면 서버가 `CaptureMeta`로 분기해야 하고, 그건
  전처리가 두 벌이 되는 것과 실질적으로 같다(설계 결정 1 위반)

네이티브가 필요해지면 **버리는 프로브**를 먼저 만들어 갭부터 측정한다 — 전체 이식이
아니라 카메라 + 3 landmarker + 기존 캡처·큐 재사용으로 `/recognize`까지만 태우면
서버가 자동 아카이빙하므로 `scripts/live_eval.py`로 웹 기준선과 A/B 할 수 있다.
`--mirror` 플래그가 전면카메라 미러 버퍼 사고를 단독으로 판별해 주므로 그것부터 배제한다.

### 알려진 구조적 한계

- **한손 재조음 갭**: 어휘 300단어 중 194단어가 학습 데이터에서 양손 조음이다.
  한 손만 보이는 입력(다른 손이 폰을 쥔 상황)은 학습에 없는 분포라 해당 단어의
  인식이 급락한다 — 한손 뷰 증강 재학습으로 대응 예정
- **깊이축 동작 단어**: 몸 쪽으로 당기는 동작처럼 움직임이 카메라 축 방향인 단어는
  x·y 투영에 신호가 거의 남지 않는다 — 손 크기(bbox scale) 피처 추가가 후속 후보
- 위 정확도 관련 수치는 소규모 진단 실측이므로 목표치·기대치로 인용하지 않는다

## 단어열 → 문장 변환

`POST /api/v1/compose-sentence`는 누적된 단어(gloss) 열을 한국어 문장 하나로 바꾼다.
경로가 둘이고, 앞의 것이 실패하면 뒤로 내려간다.

| 순서 | 경로 | `source` | 산출물 |
| --- | --- | --- | --- |
| 1 | **LLM** — Qwen3-4B / vLLM 2단계 (문장 생성 → 감정·말투 분류) | `model` | 문장 + `emotion` + `style` |
| 2 | 규칙 템플릿 (`app/ml/sentence_rules.py`) | `template` | 문장 |
| 3 | 라벨 공백 연결 | `word_list` | 단어 나열 |

LLM 구현은 별도 레포 `Ear-Dream-Gloss2Sentence`에서 이식했다
(`app/services/sentence_llm/`). **LLM 서버는 이 레포 밖에서 돌고, 없어도 된다** —
연결에 실패하면 규칙 경로로 폴백하고 사유를 서버 로그에 `llm_failed=...`로 남긴다.
`/compose-sentence`는 어떤 경우에도 200을 유지한다. 문장 다듬기 하나 때문에 화면이
멈추면 안 되고, 규칙 경로는 문장을 지어내지 않는 안전한 최소 동작이기 때문이다.

### 개발 기계별 LLM 백엔드

vLLM은 CUDA 전용이라 맥에서 돌지 않는다. 대신 **OpenAI 호환
`/chat/completions`를 내는 백엔드면 같은 코드로 붙으므로**, 기계에 따라 환경변수
두 줄만 갈아 끼운다. `packages/ear-dream-api/.env.example`을 `.env`로 복사해서 쓴다.

| 기계 | 백엔드 | 설정 |
| --- | --- | --- |
| Windows / WSL + NVIDIA GPU | vLLM (원본 검증 환경) | `BASE_URL=http://localhost:8001/v1`<br>`MODEL=Qwen/Qwen3-4B` |
| macOS | Ollama | `BASE_URL=http://localhost:11434/v1`<br>`MODEL=qwen3:4b` (+ 아래 스위치 2종) |
| 다른 기계의 GPU를 LAN으로 | vLLM (`--host 0.0.0.0`) | `BASE_URL=http://<GPU PC IP>:8001/v1` |
| LLM 없이 | — | `ENABLED=false` (또는 그냥 안 띄움 → 규칙 폴백) |

접두는 전부 `EAR_DREAM_SENTENCE_LLM_`이다.

```bash
# macOS
ollama pull qwen3:4b
```

```
EAR_DREAM_SENTENCE_LLM_ENABLED=true
EAR_DREAM_SENTENCE_LLM_BASE_URL=http://localhost:11434/v1
EAR_DREAM_SENTENCE_LLM_MODEL=qwen3:4b
EAR_DREAM_SENTENCE_LLM_REASONING_EFFORT=none
EAR_DREAM_SENTENCE_LLM_STRUCTURED_OUTPUT=true
```

**맥 프로필의 뒤 두 줄은 한 세트다.** 하나라도 빠지면 매 요청 폴백한다.

| 설정 | 없으면 |
| --- | --- |
| `REASONING_EFFORT=none` | qwen3는 thinking 모델이라 추론이 `max_tokens`를 다 먹고 응답이 빈 문자열로 잘린다(`finish_reason=length`, 요청당 **46초**). Ollama는 vLLM이 쓰는 `chat_template_kwargs.enable_thinking`을 **조용히 무시**하므로 이 OpenAI 표준 필드로만 꺼진다 |
| `STRUCTURED_OUTPUT=true` | thinking을 끈 4B는 프롬프트만으로 출력 형식을 못 지킨다 — 1단계가 `step1`/`step2` 같은 사고 과정을 JSON 필드로 뱉거나, **2단계가 분류 대신 입력을 그대로 되돌려준다**(`{"glosses":[...],"sentence":"..."}`) |

`STRUCTURED_OUTPUT`은 `response_format`을 `json_object` → `json_schema`로 바꿔 출력
계약을 디코딩 단계에서 강제한다. 스키마는 `GeneratedSentence`/`GeneratedTags`에서
파생되므로 **프롬프트는 손대지 않는다** — 프롬프트가 원본과 한 벌이라는 규칙을 지키면서
형식만 조이는 방법이다. 두 스위치 모두 기본값은 꺼짐이라 vLLM 프로필의 요청 페이로드는
원본 그대로다.

실측(M3 Pro, 2026-08-14): 두 스위치를 켠 `qwen3:4b`는 1·2단계 4/4 통과, 폴백 0건.
태그 분류는 원본 레포의 표적 예시 6/6 일치(`기쁘지 않아요.` → `neutral`/`polite`
부정 함정 포함).

**모델을 바꾸면 원본 레포의 평가 수치는 그 설정에 적용되지 않는다.** 프롬프트와
태그 분류 정확도(2단계 표적 10/10 등)는 전부 `Qwen/Qwen3-4B` **BF16 + vLLM** 위에서
나온 값이고, Ollama의 `qwen3:4b`는 같은 모델의 Q4 양자화판이다. 맥 프로필은
개발·확인용이고 시연·보고 수치는 vLLM 쪽에서 낸다. 어느 쪽을 썼는지는 응답의
`llm_model`과 서버 로그(`llm=...`)에 항상 남는다 — 설정으로 열어 두되 조용히 갈리지는
않게 한 장치다.

프롬프트는 원본 레포에서 평가를 거쳐 고정된 값이라 **한쪽만 고치지 않는다**
(`app/services/sentence_llm/prompt.py` — 고칠 때는 원본과 동시에 바꾸고
`SENTENCE_LLM_PROMPT_VERSION`을 올린다).

### 지연

요청당 LLM 추론이 2회(문장 생성 + 태그 분류)다. 지연이 문제가 되면
`EAR_DREAM_SENTENCE_LLM_TAGS_ENABLED=false`로 태그 분류를 끄면 1회로 줄고, 그때
`emotion`/`style`은 기본값이 된다. 현재 앱은 문장 텍스트만 쓰고 태그는 응답에 실려만 있다.

macOS + Ollama 실측(M3 Pro, `qwen3:4b` thinking off + 스키마 강제): 웜 상태에서
요청당 **약 1.2초**(생성 ~0.59s + 분류 ~0.63s), 모델이 메모리에 없는 첫 요청은 3초대.
vLLM(4090) 쪽 실측치는 아직 이 레포에 없다.

## 문장 → 음성 (TTS)

`POST /api/v1/speech`는 문장과 감정·말투 태그를 받아 **WAV 바이트**를 돌려준다.
`/compose-sentence` 응답의 `text`·`emotion`·`style`을 그대로 넘기면 그 감정으로 읽는다.

구현은 별도 레포 `Ear-Dream-TTS`(Qwen3-TTS 1.7B VoiceDesign / vLLM-Omni)에서
이식했다(`app/services/speech_tts/`). 원본의 중간 FastAPI는 흡수해 Core가 vLLM-Omni에
직접 붙으므로 띄울 서버는 늘지 않는다 — 문장 LLM 이식과 같은 방침이다.

### 폴백 위치가 문장 변환과 다르다

| | 실패하면 |
| --- | --- |
| 문장 변환 LLM | **서버 안에서** 규칙 경로로 폴백 → 200 |
| TTS | **503** → 앱이 브라우저 음성 합성(SpeechSynthesis)으로 폴백 |

서버에는 대체 음성을 만들 수단이 없고 브라우저에는 있기 때문이다. 그래서 `/speech`의
503은 고장이 아니라 **"이 서버로는 못 읽는다"는 신호**이며, 앱은 이걸 에러로 표시하지
않는다. 어느 쪽으로 소리가 났는지는 훅의 `engine`(`server` | `browser`)에 남는다.

### 설정

```
EAR_DREAM_TTS_ENABLED=true
EAR_DREAM_TTS_BASE_URL=http://localhost:8091
```

**vLLM-Omni는 CUDA 전용이라 맥에서 못 켠다.** 문장 LLM에는 Ollama라는 맥 대체재가
있었지만 TTS에는 없다 — 맥에서는 항상 브라우저 음성으로 읽고, Qwen3-TTS 음성은 GPU
기계에서만 확인할 수 있다. 그래서 기본값이 꺼짐이다(켜 두면 재생마다 연결 실패를
기다렸다 폴백해 첫 소리가 늦어진다).

감정 6종은 문장 LLM과 정확히 같고, 말투는 TTS가 7종·문장 LLM이 4종으로 우리 쪽이
부분집합이라 변환 없이 그대로 흐른다. TTS에만 있는 3종(`excited`/`calm`/`serious`)은
instruction 표에 남겨 뒀다 — 태그 분류를 넓힐 때 쓰려고.

⚠️ 지연은 원본 README 실측 예시가 요청당 **6.1초**다. 이 레포에서 잰 값은 아직 없다.
서버 상한 15s, 앱 상한 20s는 임시값이며 앱 상한이 더 길어야 서버의 503 폴백 신호가
전달된다.

## 현재 상태

| 엔드포인트 | 상태 |
| --- | --- |
| `GET /health` | 동작 — `status`, `model_loaded`, `vocab_size` |
| `POST /api/v1/recognize` | 동작 — 랜드마크 세그먼트 → 단어 후보 top-k |
| `POST /api/v1/compose-sentence` | 동작 — 단어 열 → 문장 (LLM, 실패 시 규칙 폴백) |
| `POST /api/v1/speech` | 동작 — 문장+태그 → WAV. 서버 미가동 시 503(앱이 브라우저 음성으로 폴백) |
| `GET /api/v1/vocabulary` | 동작 — 어휘 300단어 카탈로그 |
| `GET /api/v1/model` | 동작 — 모델·전처리·계약 정보 |
| `GET /api/v1/phrases` | 스키마만 확정, 빈 배열 반환 |

## 로드맵

기술 리스크가 큰 인식 부분을 먼저 검증하는 순서로 진행했다.

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| M0 | 카메라 + 손·얼굴·포즈 랜드마크 추출 | 완료 (웹) |
| M1 | 제한 어휘 인식, 후보 top-N (30단어 → 현재 300단어로 확장) | 완료 |
| M2 | 후보 확정, 단어 누적 → 문장 변환, 텍스트 표시 | 완료 |
| M3 | 오인식 정정, 상황 문장 호출 | 부분 — 정정(후보 교체·삭제·재전송)은 됨, 상황 문장 미착수 |
| M4 | 음성 → 수어 영상 | 미착수 (화면 흐름은 mock) |
| M5 | WebRTC 양방향 세션 | 미착수 |

다음 단계로 확정된 것: 단어당 버튼 캡처를 발화 단위 촬영 + 서버 오프라인 분절(손 keypoint
정지 구간 기준)로 전환한다. 아직 구현 전이다.

인식 정확도, 허용 지연 시간, 후보 개수는 아직 확정되지 않았다. 학습 데이터셋(통제 환경)
기준 평가 수치는 실사용 환경의 정확도와 다르므로 목표치나 기대치로 사용하지 않는다.
실기기·실사용 조건의 실측이 끝나기 전까지 임의의 값을 목표치로 사용하지 않는다.
