# Ear Dream Core

FastAPI + React Native 기반의 한손 수어 인식 실시간 통역 서비스

기존 수어 인식 서비스는 대부분 양손 수어를 전제로 하며, 휴대폰을 거치할 수 있는 환경에서만
제대로 동작한다. 이 프로젝트는 이동 중처럼 한 손만 자유로운 상황에서의 수어 소통을 다룬다.

- 농인 → 청인: 수어 동작을 단어 단위로 인식 → 1순위 후보로 자동 확정해 단어 누적
  (오인식은 단어를 탭해 후보 교체·삭제) → 문장 변환 → 텍스트 전달
- 청인 → 농인: 음성 인식(STT) → 문장을 어휘 단어로 분해 → 단어별 수어 동작을
  아바타로 재생

> 설계와 파이프라인은 [아키텍처 문서](docs/architecture.md)에 있다.

## 빠른 시작

**요구사항** — Node.js 20+, Python 3.12+, pnpm, uv

```bash
brew install node pnpm uv                       # macOS
```

```powershell
winget install OpenJS.NodeJS astral-sh.uv       # Windows
npm install -g pnpm
```

**설치** — 클론 직후 두 번이면 끝난다.

```bash
pnpm install
pnpm setup
```

`pnpm setup`은 커밋하지 않는 산출물 셋을 만든다 — 파이썬 의존성(`uv sync`),
API 타입, 수어 인식 모델 번들.

**실행** — 터미널 두 개.

```bash
pnpm dev:api    # API 서버 — http://localhost:8000
```

```bash
pnpm dev:web    # 앱 — 브라우저가 자동으로 열린다
```

첫 실행 시 MediaPipe WASM·모델(약 50MB)을 자동으로 받는다. 수어 입력 화면에서
카메라 권한을 허용하면 끝이다. API 문서는 http://localhost:8000/docs 에 있다.

인식 모델은 API 서버에 in-process로 로드되므로 별도 프로세스가 없다. 문장 변환 LLM과
음성 합성은 GPU 서버가 필요한 [선택 기능](docs/optional-services.md)이고, 없어도
규칙 폴백과 브라우저 음성으로 전 구간이 돈다.

폰에서 카메라까지 확인하려면 [개발 가이드](docs/development.md)의 「실기기(모바일 웹)」를 본다.

> **모델 번들이 없어도 서버는 뜬다.** `POST /api/v1/recognize`만 503이 되고
> `GET /health`의 `model_loaded`가 `false`가 된다 — 문장 변환·아바타·음성은 그대로
> 동작한다. 다시 받으려면 `pnpm setup:model-bundle`.

## 구성

```
packages/
  core/            // 공유 API 계약 (OpenAPI에서 생성한 TS 타입)
  ear-dream-api/   // FastAPI 서버 — 수어 단어 인식 추론, 문장 변환
  ear-dream-app/   // Expo, React Native 앱
```

수어 인식 모델의 학습·실험 코드는 별도 레포에 있고, 이 레포의 서버는 그 학습
산출물(모델 번들)을 읽어 서빙만 한다.

## 명령어

| 명령어 | 설명 |
| --- | --- |
| `pnpm setup` | 클론 직후 1회 — uv sync + API 타입 + 모델 번들 |
| `pnpm dev:api` | API 서버 |
| `pnpm dev:web` | 앱 (브라우저) |
| `pnpm dev:app` | 앱 (QR / 시뮬레이터 / 에뮬레이터) |
| `pnpm build:web-mobile` | 실기기용 웹 내보내기 (API를 상대경로로, gzip 사이드카 포함) |
| `pnpm serve:mobile` | 웹 + API 단일 오리진 서버 (8080 평문 — 터널 전제) |
| `pnpm typecheck` | TypeScript 타입 검사 |
| `pnpm test:api` | API 테스트 |
| `pnpm lint:api` | API 린트 |
| `pnpm generate:api-types` | API 타입 재생성 (스키마·라우트 변경 후) |
| `pnpm setup:model-bundle` | 모델 번들 다시 받기 (`--force`로 재설치) |

MediaPipe 애셋·폰트 서브셋·gzip 사이드카는 위 명령들이 알아서 만든다. 아바타 시퀀스를
원본 영상에서 다시 뽑는 일은 드물어서 스크립트를 직접 부른다 —
`cd packages/ear-dream-api && uv run python scripts/build_sign_sequences.py`.

## 문서

| 문서 | 내용 |
| --- | --- |
| [아키텍처](docs/architecture.md) | 양방향 파이프라인, 인식 모델(SPOTER-208), 라이브 도메인 보정, 알려진 한계 |
| [개발 가이드](docs/development.md) | 실기기(모바일 웹), 앱 실행 대상, API 주소 설정, API 타입 생성, 모델 번들 배포 |
| [선택 기능](docs/optional-services.md) | 문장 변환 LLM · 음성 합성 서버 설정 |

## 현재 상태

| 엔드포인트 | 상태 |
| --- | --- |
| `GET /health` | 동작 — `status`, `model_loaded`, `vocab_size` |
| `POST /api/v1/recognize` | 동작 — 랜드마크 세그먼트 → 단어 후보 top-k |
| `POST /api/v1/compose-sentence` | 동작 — 단어 열 → 문장 (LLM, 실패 시 규칙 폴백) |
| `POST /api/v1/speech` | 동작 — 문장+태그 → WAV. 서버 미가동 시 503(앱이 브라우저 음성으로 폴백) |
| `POST /api/v1/sign-sequence` | 동작 — 문장 → 아바타가 재생할 단어 열. 문장 분해는 템플릿 역인덱스 + 형태소 분석(kiwipiepy), 변환 모델은 미착수 |
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
| M4 | 음성 → 수어 영상 | 부분 — STT·문장 분해·아바타 재생은 됨. 어휘 **300단어 전부** 동작 시퀀스 보유. 조음 정확성 육안 검증 전 |
| M5 | WebRTC 양방향 세션 | 미착수 |

다음 단계로 확정된 것: 단어당 버튼 캡처를 발화 단위 촬영 + 서버 오프라인 분절(손 keypoint
정지 구간 기준)로 전환한다. 아직 구현 전이다.

인식 정확도, 허용 지연 시간, 후보 개수는 아직 확정되지 않았다. 학습 데이터셋(통제 환경)
기준 평가 수치는 실사용 환경의 정확도와 다르므로 목표치나 기대치로 사용하지 않는다.
실기기·실사용 조건의 실측이 끝나기 전까지 임의의 값을 목표치로 사용하지 않는다.
