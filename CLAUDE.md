# Ear Dream Core

한손 수어 인식 실시간 통역 서비스 MVP. pnpm workspace 모노레포.

- `packages/ear-dream-api` — FastAPI (Python 3.12+, uv). 의존성 추가는 `uv add`, 실행은 `uv run`.
- `packages/ear-dream-app` — Expo / React Native (TypeScript). 패키지명 `@ear-dream/app`.
- `packages/core` — 공유 API 계약 (`@ear-dream/core`). `src/generated/`는 생성물이니 직접 수정하지 말 것.

`ear-dream-api`는 Python 프로젝트라 pnpm 워크스페이스에 포함되지 않는다.

모델 학습·실험은 **형제 디렉토리의 별도 레포 `../Ear-Dream-Model`**에 있다 —
「서빙 모델과 Ear-Dream-Model 레포」 절 참고.

## 에이전트와 스킬

`.claude/agents/` — 역할별 에이전트.

| 에이전트 | 담당 |
| --- | --- |
| `architect` | 설계 판단, 문서·코드 정합성, 새 의존성 도입 |
| `pm` | Tasks DB와 코드 상태 대조, 다음 작업 결정 |
| `prd-writer` | PRD 작성. 산출물은 Notion으로 간다 |
| `api-architect` | 엔드포인트·요청/응답 설계 |
| `backend-dev` | FastAPI 라우트, Pydantic 스키마, pytest |
| `ml-dev` | 데이터셋, 어휘, 전처리, 학습, 평가 |
| `frontend-dev` | 앱 화면·컴포넌트·카메라·랜드마크 (앱 코드의 주 담당) |
| `app-developer` | 앱 **구조** 변경(네비게이션 재편, 상태 관리 도입, 네이티브 전환). `frontend-dev`와 겹치므로 화면 단위 작업에는 쓰지 않는다 |
| `api-integrator` | 생성 타입 소비, 호출 시점·취소·에러 상태 |

`.claude/skills/` — `frontend-dev`(앱 개발 규칙), `api-designer`(API 설계 파이프라인),
`rest-api-conventions`·`api-error-design`(api-architect 확장). 해당 파트를 건드리기 전에 읽는다.

`api-*` 계열 에이전트와 스킬은 다른 프로젝트에서 가져온 것이라 각 문서 앞부분에
**「이 프로젝트에서」/「이 프로젝트 적용」 절**이 붙어 있다. 그 절이 문서의 일반 원칙보다 우선한다.
일반 REST 관행 중 이 서비스에 해당하지 않는 것(페이지네이션·HATEOAS·envelope·OAuth·RFC 7807)이
많으니, 그 절을 건너뛰고 본문만 따르면 안 된다.

## 서비스 흐름 (2026-08 방향 전환 — 확정·구현 완료)

**단어 단위 인식 → 클라이언트 pill 큐 누적 → 서버 문장 변환.**

- 수어 동작 하나(단어)를 **버튼을 누르는 동안** 캡처해 `POST /recognize`로 보낸다.
  릴리즈 즉시 큐 끝에 대기 pill이 붙고, 응답이 오면 **top-1로 자동 확정**된다 —
  단어마다 후보 화면으로 전환하는 흐름은 pill 큐 UX 확정(2026-08-10)으로 제거됐다.
  오확정 정정은 pill 탭 → 하단 시트(top-k 교체/삭제), 전송 실패 pill은 탭으로 재전송한다
- 누적된 단어 ID 열을 `POST /compose-sentence`가 자연스러운 문장으로 바꾼다 —
  Qwen3-4B(vLLM) 우선, 실패 시 규칙 폴백 (「단어열 → 문장 변환 LLM」 절)
- 정규화 기준은 **어깨(포즈 랜드마크)**다 — 프론트가 PoseLandmarker를 함께 돌린다

**MVP 이후 (팀 확정, 미구현)**

- 단어당 버튼 → **발화 단위로 한 번에 촬영**하고, 손 keypoint 정지 구간을 서버가
  오프라인으로 분절하는 방식으로 전환 예정. 현재 스키마의 `boundary_mode`가 이 전환을
  예비해 둔 필드다
- 그 다음: STT로 청인 입력 처리 → 농인에게 수어 아바타 영상 (미착수)

이 전환은 Notion에 반영됐다 — PRD 신설, Tasks DB에 T-17~T-29 추가, T-04 제목 정정,
T-05·T-06 완료 처리.

**Figma** — UI v2(MVP)는 `UI` 섹션(85:293), 새 방향 화면(「문장 확인」·「단어 조립」·
「체험 우선 첫 화면」)은 `검증 필요` 섹션(151:1042)에 있다.

## 설계 문서

Notion 「[열정 3팀] 이어드림(Ear-Dream)」 하위에 있다.

SRS(무엇을/왜) → 기능 명세서(무엇을 만드나) → **MVP 아키텍처 및 개발 로드맵(어떻게)** → PRD → Tasks DB(T-01~T-29)

**아래 문서와 충돌하면 「MVP 아키텍처 및 개발 로드맵」이 우선한다.** 다만 그 문서는
Vite 웹앱 + `web/`·`server/`·`ml/` 구조를 상정하고 있고, 이 레포는 Expo 모노레포다.
경로를 그대로 따르지 말고 의도를 읽어 옮긴다.

`[확인필요]` 표시 항목은 아직 미확정이다.

## 전처리 정본은 한 곳 (설계 결정 1)

프론트는 **가공하지 않은 랜드마크 세그먼트를 그대로 전송**한다. 정규화·보간·리샘플은
서버에서만 한다. 전처리가 두 벌이 되면 미세한 불일치가 정확도를 조용히 망가뜨리고
(train/serve skew), 증상이 "학습은 잘 됐는데 실사용은 틀림"으로 나타나 원인 추적이 어렵다.

정본 관계가 구체화됐다: **학습 정본은 모델 레포 `src/dataset.py`이고, 서버
`app/ml/preprocess.py`는 그 eval 경로(train=False 분기)의 포팅본**이다. 어느 시점의
dataset.py와 동기화됐는지는 `PREPROCESS_VERSION`(현재 `"2"`)으로 기록하며,
포팅본을 고칠 때는 모델 레포와 동시에 바꾸고 버전을 갱신한다.

**종횡비 처리는 버전에 묶인 학습 계약이다.** v1은 MediaPipe 정규화 좌표(x를 너비로,
y를 높이로 나눈 값)를 보정 없이 그대로 썼다. v2(현재)는 `normalize_signer` 첫 단계에서
픽셀 비율을 복원한다 — `x ← x×AR`(AR = `CaptureMeta.source_width/height` 실측값), 즉
등방 정규화다. 이 전환은 학습(정본 dataset.py v2, exp13 재학습)과 서빙을 **동시에**
바꾸고 `PREPROCESS_VERSION`을 올린 사례다 — "동시 변경 + 버전 갱신" 규칙이 실제로
이렇게 쓰인다. 서빙 쪽만 "개선"이라며 보정을 넣거나 빼는 순간 학습 분포와 어긋난다는
원칙은 그대로다. 같은 이유로 좌표 반올림·클리핑도 임의로 추가하지 않는다.
`source_width/height`는 v1에서는 추적용 메타데이터였지만 v2부터는 전처리 입력값이다 —
항상 실측 해상도를 싣는다.

페이로드: 얼굴 원본 메쉬(468/478점)까지 포함하면 세그먼트 하나가 **수백 KB 수준**이다
(초기의 "수 KB" 추정은 손만 기준이었다). 그래도 유지하는 이유 — 스트리밍이 아니라
**단어당 1회** 요청이라 빈도가 낮고, 얼굴 축약(78점 서브셋 선택)은 서버
`keypoint_layout` 한 곳에서만 일어나야 하기 때문이다.

예외: 프론트의 캡처 타이밍(프리롤/포스트롤 링 버퍼)은 "어떤 프레임을 보낼지"의 문제이지
전처리가 아니다 — 앞뒤 여유분은 서버 `trim_rest`가 잘라낸다.

## API 계약 규칙

API 타입의 단일 진실 공급원은 `packages/ear-dream-api/app/schemas/`의 Pydantic 모델이다.
프론트에서 요청/응답 타입을 손으로 정의하지 말고 `@ear-dream/core`에서 import한다.

스키마나 라우트를 변경한 뒤에는 반드시 `pnpm generate:api-types`를 실행한다.

FastAPI는 라우트가 참조하는 모델만 OpenAPI로 내보낸다. 어떤 엔드포인트도 쓰지 않는
Pydantic 모델은 생성된 TS에 나타나지 않는다.

손/얼굴/포즈 좌표는 전부 `number[][]`라 구조적으로 동형이다. 스키마에서 이름 있는 모델
(`HandObservation`·`FaceObservation`·`PoseObservation`)로 감싸 생성 TS에서도 구분되게
해 두었다 — 서로 바꿔 넣어도 타입 검사가 통과하는 사고를 막기 위해서다.

## 버전 고정 사항

TypeScript는 Expo SDK 57이 고정한 `~6.0.3`에 맞춰 `core`와 `app` 양쪽을 통일해 두었다.
한쪽만 올리지 말 것. `openapi-typescript`의 TS peer 예외는 `pnpm-workspace.yaml`에 명시되어 있다.

## 서빙 모델과 Ear-Dream-Model 레포

학습·실험은 형제 디렉토리 `../Ear-Dream-Model`(별도 레포)에서 한다. 30단어 분류기
(SqueezeformerLite `small` — d=128, 4층, 1.12M 파라미터. v2 전처리 + **z-off**로 재학습)가
학습돼 있고, 서버가 체크포인트를 **경로 참조**로 로드한다 — 레포에 복사·커밋하지 않는다.

**z-off 채택 경위**: 라이브 정확도 붕괴의 주범이 tasks-vision↔Holistic **pose z 추출기
갭**으로 실측 확정됐다(실사용 pose raw z −1.91±1.33 vs 학습 분포 −0.18±0.20). z 증강
재학습(1안)은 실측에서 실패했고, z를 아예 쓰지 않는 z-off 재학습(2안)이 z 교란에 완전
면역이면서 스튜디오 97.9%(+1.0%p)로 회귀도 없어 채택됐다. 남은 최대 미지수는
tasks-vision의 **x·y 검출 특성 차이**다 — 미달 시 xy 원근 왜곡 증강, 그래도 안 되면
라운드3(tasks-vision 재추출) 순으로 대응한다.

- 체크포인트 기본 경로: `../../../Ear-Dream-Model/experiments/runs/exp15_small_v2_z-off_f4/best.pt`
  (api 패키지 루트 기준. `EAR_DREAM_MODEL_CHECKPOINT_PATH`로 변경 가능 — `app/core/config.py`)
- 로딩 실패 시 서버는 뜨되 `/recognize`가 503을 반환하고 `/health`의 `model_loaded`가 false다
- **로드 게이트**: 체크포인트 wrapper의 `preprocess_version`이 서버 값과 불일치하면 로드를
  거부한다 — 구모델+신전처리(또는 그 반대) 조합 사고를 막는 장치다. `use_z`는 거부
  조건이 아니라 **전처리 분기 입력**이다: 값을 읽어 use_z=false면 전처리가 z를 0으로
  고정한다(위치·속도 모두 — 입력 shape 780은 유지. 정본 dataset.py `zero_z`의 포팅으로
  트리밍 이전에 적용). `use_z` 필드 자체가 없는 구형 체크포인트만 거부한다
- **클래스 인덱스 ↔ 어휘 매핑의 정본은 체크포인트 내장 `class_labels`다.** 모델 레포
  `train.py`의 `load_manifest()`가 `sorted(단어)`(유니코드 코드포인트)로 라벨을 만들므로,
  서버 `app/ml/vocab.py`가 같은 정렬을 재현해 로드 시 **교차 검증**하고 불일치면 로드를
  거부한다. 여기가 틀리면 조용히 전부 오답이 된다 — 어휘를 바꾸면 학습 라벨 순서부터
  다시 확인할 것 (`VOCAB_VERSION`으로 대응 기록)
- **캘리브레이션**: temperature scaling 값을 모델 레포 `experiments/calibration.json`에서
  로드해(현재 **0.6024**) softmax 전에 적용한다. 파일이 없으면 1.0 + 경고 로그.
  calibration.json은 `current` + 이력 보존형으로 개편됐고 로더는 신구 형식을 모두
  지원한다. reject 임계는 **0.45**(캘리브레이션 후 confidence 기준) — 결합 스트레스
  스윕의 균형점으로 고른 값이며 여전히 임시값이다. 라벨된 실사용 아카이브가 생기면
  재조정한다. **재조정 시 함정**: 오답이 0개인 셋으로 temperature를 피팅하면 T→0으로
  발산한다 — 오답 표본이 있는 라벨셋인지부터 확인할 것
- 모델 입력은 **130 키포인트** = 양손 42 + 상체 포즈 10(NECK은 합성점) + 얼굴 78 서브셋.
  `app/ml/keypoint_layout.py`는 모델 레포 `src/keypoint_layout.py`의 포팅본이라 임의 수정 금지
  (검증: `tests/test_keypoint_layout.py`)
- 전처리 대응은 `PREPROCESS_VERSION`, 어휘는 `VOCAB_VERSION`, 문장 규칙은 `RULESET_VERSION`
  으로 응답·`/model`에 실린다

평가 수치(z-off, exp15): unseen 화자 top-1 **스튜디오 97.9%**, **셀카 프록시 73.7%**.
프록시는 스튜디오 데이터에 합성 변환을 가한 **상한 추정치이지 실측이 아니다** — 실사용
기대치로 인용하지 말 것. 실사용 아카이브 재평가에서는 "꿈" 쏠림이 74.5% → **2%**로
해소되고 top-1이 14종으로 다양화됐으나, **아카이브에 정답 라벨이 없어 실제 정답률은
미지**다.

어휘 30단어의 조음 구성은 **한손 9 / 양손 21**로 완벽한 이봉 분포다(중간 없음). 한손
서비스 전제와 어긋나는 양손 단어의 "한손 재조음"은 학습 데이터에 0클립이라, 다음 라운드는
직촬 파일럿으로 이를 닫는다(모델 레포 `_workspace/10_round3_brief.md`). 단 이 분석 중
실사용 recognized 사례에 기댄 5단어 판정은 라벨 미검증이라 확정 사실로 인용하지 말 것.

## 엔드포인트

| 경로 | 내용 |
| --- | --- |
| `GET /health` | `status` + `model_loaded` + `vocab_size` |
| `POST /api/v1/recognize` | 랜드마크 세그먼트 → 단어 후보 top-k (`recognized`/`rejected`/`low_quality`) |
| `POST /api/v1/compose-sentence` | 단어 ID 열 → 문장 (LLM → 규칙 폴백 — 아래 절) |
| `GET /api/v1/vocabulary` | 어휘 30단어 카탈로그 |
| `GET /api/v1/model` | 모델·전처리·계약 정보 (min/max_frames 등 — 클라이언트가 계약을 내려받는 곳) |
| `GET /api/v1/phrases` | 스켈레톤 — 빈 배열 (상황 문장 미착수) |

- `/recognize`의 응답 시간 로깅은 NFR-01(허용 지연) 확정의 유일한 근거 데이터다 — 지우지 말 것
- `/recognize` 요청은 **Pydantic 검증 이전**에 raw body를 아카이빙한다
  (`app/services/archive.py` → `var/archive/`, .gitignore 대상). 422로 거절된 요청도
  데이터셋 후보이므로 커스텀 APIRoute 앞단에서 저장한다
- 아카이브·진단 파일 네이밍은 사람 친화적이다 — 아카이브는
  `var/archive/{MMDD_HHMM}_{sess8}/{seq:03d}_{req8}.json.gz`, 진단(`app/services/diagnostics.py`
  → `var/diagnostics/`)은 같은 규칙에 `_{status}[_{top1라벨}]` 접미를 더해 ls만으로 훑을 수
  있다. 두 파일은 `{seq:03d}_{req8}` 접두로 조인되며, 터미널 로그의 마지막 필드
  (`archive=`/`diag=`)에 절대경로가 찍힌다

## 단어열 → 문장 변환 LLM (Gloss2Sentence 이식)

`/compose-sentence` 는 **LLM 우선 → 규칙 폴백** 2경로다.

1. `app/services/sentence_llm/` — Qwen3-4B / vLLM 2단계 (문장 생성 → 감정·말투 분류).
   별도 레포 **`Ear-Dream-Gloss2Sentence`** 의 `app/sentence_generation/` 이식본이다
2. `app/ml/sentence_rules.py` — 기존 규칙 (`template` → `word_list`)

**폴백은 500 을 내지 않는다.** LLM 서버는 이 레포 밖에서 도는 외부 의존이고, 그것 하나로
화면이 멈추면 안 된다 — **LLM 없이도 맥북 단독으로 전 구간이 돈다**. 실패 시 규칙으로
내려가되 사유를 로그에 `llm_failed=<예외종류>` 로 남긴다 — 폴백이 조용하면 vLLM 이
죽은 걸 아무도 모른다. 원본 레포는 502/503/504 로 실패를 노출했지만 그쪽은 문장 변환
**전용** 서비스라 폴백할 곳이 없었다는 차이다.

- **프롬프트는 원본과 한 벌이다** (`sentence_llm/prompt.py`). Qwen3-4B 위에서 시나리오·
  2단계 표적 평가를 거쳐 고정된 문구라 한 줄만 바꿔도 출력 분포가 달라진다. 고칠 때는
  원본 레포와 **동시에** 바꾸고 `SENTENCE_LLM_PROMPT_VERSION` 을 올린다 — 전처리 정본
  규칙(설계 결정 1)과 같은 취지다
- **백엔드는 기계마다 갈린다** — vLLM 이 CUDA 전용이라 맥에서 안 돈다. Windows/WSL 은
  vLLM(`:8001`, `Qwen/Qwen3-4B` BF16), macOS 는 Ollama(`:11434`, `qwen3:4b` Q4).
  둘 다 OpenAI 호환 `/chat/completions` 라 클라이언트는 하나고, 갈리는 건 설정뿐이다
  (README 「개발 기계별 LLM 백엔드」·`.env.example`)
- **맥 프로필은 스위치 2종이 한 세트다** (2026-08-14 실측 — 하나라도 빠지면 매 요청 폴백):
  `sentence_llm_reasoning_effort="none"` 이 없으면 thinking 이 `max_tokens` 를 다 먹어
  응답이 빈 문자열로 잘리고 46초가 걸린다 (Ollama 는 vLLM 이 쓰는
  `chat_template_kwargs.enable_thinking` 을 **조용히 무시**한다).
  `sentence_llm_structured_output=true` 가 없으면 thinking 을 끈 4B 가 출력 형식을
  못 지킨다 — 1단계가 `step1`/`step2` 를 필드로 뱉거나 **2단계가 분류 대신 입력을
  되돌려준다**. 이 스위치는 `response_format` 을 `json_schema` 로 바꿔 출력 계약을
  디코딩에서 강제하며, **스키마는 `GeneratedSentence`/`GeneratedTags` 에서 파생되므로
  프롬프트는 손대지 않는다** (프롬프트 한 벌 규칙을 지키면서 형식만 조이는 방법).
  둘 다 기본값 꺼짐이라 vLLM 프로필 페이로드는 원본 그대로다
- 켠 상태 실측: 1·2단계 4/4, 폴백 0건, 웜 1.2초. 태그는 원본 표적 예시 6/6 일치
  (`기쁘지 않아요.` → neutral/polite 부정 함정 포함)
- **모델 ID 는 설정으로 열려 있지만 기본값은 검증 모델(`Qwen/Qwen3-4B`)이다.** 원본 레포는
  상수로 못 박아 뒀고 그 취지("모델이 **조용히** 갈리면 프롬프트·평가와 서빙이 어긋난다")는
  유효하다 — 위 분기 때문에 열되, 실제 호출한 모델을 응답 `llm_model` 과 로그 `llm=` 에
  항상 싣는 것으로 그 취지를 지킨다. 다른 모델을 넣으면 원본 평가 수치는 적용되지 않는다
- LLM 입력은 어휘 ID 가 아니라 **라벨(gloss)** 이다 — 프롬프트가 한국어 라벨 열로 평가됐다.
  라우트가 `ID_TO_ENTRY` 로 변환해 넘긴다. 어휘 검증(422)은 LLM 호출보다 먼저다
- 설정은 `EAR_DREAM_SENTENCE_LLM_*` (`app/core/config.py`). `..._ENABLED` 기본 true,
  `..._BASE_URL` 기본 `http://localhost:8001/v1`, `..._TAGS_ENABLED` 로 2단계 태그 분류를
  끄면 요청당 추론이 절반이 된다(태그는 기본값이 됨). timeout 10s 는 임시값 — 프론트
  상한 15s(`RECOGNIZE_TIMEOUT_MS`)보다 먼저 끊어져 폴백이 돌게 잡은 값이고, 2단계 실측
  latency 는 이 레포에 아직 없다
- 감정·말투(`emotion`/`style`)는 `source="model"` 일 때만 채워지고 규칙 경로는 null 이다.
  **현재 앱은 문장 텍스트만 쓴다** — 태그는 응답에 실려만 있고 TTS 에 반영하지 않는다
  (음성 파라미터 매핑은 근거 없는 값이라 임의로 넣지 않았다)
- 테스트는 `tests/test_sentence_llm.py` (httpx MockTransport + 가짜 생성기). conftest 의
  `client` 픽스처는 LLM 을 **꺼서** 규칙 테스트가 외부 서버에 의존하지 않게 한다

## 손 · 얼굴 · 포즈 랜드마크 추출

`packages/ear-dream-app/src/features/recognition/landmarks/`

`useLandmarker` 훅이 추출을 담당하고, `types.ts`가 플랫폼 중립 계약이다. 네이티브나 서버
추론으로 전환하더라도 훅 구현만 바꾸면 되도록 격리해 두었다.

**모델은 셋이다: HandLandmarker + FaceLandmarker + PoseLandmarker(lite).** 포즈는 방향
전환(어깨 기준 정규화)과 서버의 손 좌우 배정에 필요해서 추가됐다. lite 선택은 임시값이다 —
근거와 교체 절차는 `scripts/setup-mediapipe-assets.mjs` 참고. 얼굴은 비수지신호(눈썹·시선·
입모양·고개)가 수어의 문법 요소라 손만으로는 의문문·부정이 구분되지 않기 때문에 뽑는다.

서버 전송 계약은 `@ear-dream/core` 생성 타입(`LandmarkFrame`·`HandObservation`·
`FaceObservation`·`PoseObservation`)이다. `types.ts`의 `FaceFrame` 등은 앱 내부(오버레이·
표시) 계약으로 남아 있다 — 전송용으로 손으로 타입을 만들지 말 것.

`LandmarkSnapshot`의 `face`는 **그 프레임의 관측값**이고, 검출을 건너뛰었거나 얼굴이 없으면
`null`이다. 오버레이 깜빡임 방지용 `displayFace`는 **표시 전용**이다. 버퍼에 쌓거나 전송할 때
`displayFace`를 쓰면 안 된다 — 직전 값 유지는 결측치 대치이고, 대치 정책(선형 보간)은 서버
전처리 한 곳에만 있다(설계 결정 1). `pose`도 같은 규칙이다.

**추론 백엔드는 `delegate: 'GPU'`다.** tasks-vision의 기본값이 CPU라서 명시하지 않으면 CPU로
돈다. 개발 환경(M3 Pro/Chrome) 실측으로 CPU 41.5ms/프레임 vs GPU 13.2ms였다(손+얼굴 기준,
포즈 추가 후는 미측정). FPS 기록은 **어느 백엔드로 잰 값인지 모르면 쓸모가 없다** — 개발 화면
HUD가 실제 적용된 백엔드를 표시하고, GPU 생성이 실패하면 CPU로 폴백한다.

`outputFaceBlendshapes`는 끄고 원본 메쉬를 그대로 내보낸다. blendshape은 이미 전처리라
켜는 순간 학습과 다른 두 번째 전처리 경로가 생긴다(설계 결정 1). 얼굴 지점 축약(78점)은
서버 `keypoint_layout`에서만 한다. 메쉬 점 개수는 모델 구성에 따라 468 또는 478이며 서버가
둘 다 허용한다(`face_point_counts`) — 문서에 단정해 박아두지 말 것.

Holistic 단일 모델은 검토 후 쓰지 않기로 했다. 손을 좌/우로 미리 갈라 주고 handedness
score가 없어서 좌우 라벨 검증이 모델 안으로 숨는다. 포즈가 필요해진 지금도 이 결정은
유지한다 — 별도 PoseLandmarker를 쓴다.

**handedness: 좌우 배정은 서버가 한다.** 서버가 포즈 손목 기하 매칭을 1순위로 손의 좌우를
배정하므로, 프론트에서 라벨을 보정할 필요는 영구히 없어졌다 — 라벨과 score는 **원본
그대로** 전송하고 서버의 fallback으로만 쓰인다. 단 `HANDEDNESS_VERIFIED`(현재 false) 실측
항목 자체는 유효하다 — 아카이브 데이터 해석과 fallback 신뢰도의 근거가 된다. 절차는
`handedness.ts` 주석에 있다. 추측으로 고치지 말고 실측한다.

**MediaPipe는 현재 브라우저 WASM 기반이라 웹에서만 동작한다.** Expo Go에서는 안내 문구가
표시되며 이는 의도된 동작이다.

`@mediapipe/tasks-vision`을 직접 import하면 라이브러리 내부의 비정적 동적 import 때문에
Metro 빌드가 실패한다. UMD 빌드를 로컬 `<script>`로 싣는 우회가 적용되어 있으니
"그냥 import하면 되는데"라며 되돌리지 말 것. 타입은 `import type`으로 유지된다.

WASM·모델 파일(실측 약 50MB — WASM 약 34MB + 손 7.5MB + 얼굴 3.7MB + 포즈 5.5MB)은
커밋하지 않는다. `pnpm setup:mediapipe`로 내려받으며 `pnpm dev:web`이 자동 실행한다.
파일 단위로 존재를 확인하므로 기존 환경에서는 없는 모델만 추가로 받는다.
CDN 직로드는 데모 현장 네트워크에 의존하게 되므로 쓰지 않는다.

## 세그먼트 캡처와 인식 흐름

- `features/recognition/capture/` — 단어당 버튼을 **누르는 동안** 프레임을 모은다
  (`BoundaryMode.manual`). 프리롤 500ms(누르기 전 링 버퍼) / 포스트롤 300ms는 **미확정
  임시값**이다 — 근거는 `capture/config.ts` 주석에 있다
- **미해결 이슈**: 실사용 아카이브의 약 35%가 손 검출 0 프레임뿐인 세그먼트다. 모델과
  무관한 프론트 캡처 타이밍 이슈로, 아직 원인 규명·수정이 안 됐다 — v2 모델 교체로는
  해소되지 않는다
- `features/recognition/api/` — `useRecognitionQueue`(엔트리별 독립 요청, 큐 순서 보존,
  타임아웃·취소 포함. **전송 실패**(503/네트워크/타임아웃 — pill 보존 + 탭 재전송)와
  **인식 실패**(rejected/low_quality — pill 제거 + "다시 동작" 안내)를 구분한다),
  `useSentenceComposer`, `useVocabulary`. 서버 카탈로그(`/vocabulary` + `/model`)는 부팅 시
  1회 로드하고, 실패해도 앱은 뜬다(화면은 배너 수준으로만 알림)
- `SignFlow`가 농인 트랙 컨테이너다 — 인식 큐와 `session_id`를 최상위에서 소유해
  화면 전환(input ↔ result 둘뿐)에도 큐가 유지된다. 단어별 후보 화면(구 `CandidateScreen`)은
  pill 큐 UX 확정으로 삭제됐다 — 정정은 입력 화면의 pill(`QueuePill`) 탭 →
  `WordCandidateSheet`(하단 시트, top-k 교체/삭제)가 담당하고, `transcript/ResultScreen`이
  확정 단어 병기·`word_list` 구분 표시와 TTS(`transcript/speech/useSpeech`) 재생을 담당한다

## 검증

변경 후에는 레포 최상위에서 `pnpm typecheck`와 `pnpm test:api`를 돌린다.

## 현재 진행 상황

**MVP 구현 완료** — 단어 인식 → pill 큐 누적 → 문장 변환이 실제 모델로 끝까지 돈다(웹).
이전에 나열했던 "설계 문서와 스키마의 차이"(RecognizeRequest 재설계, 프레임 수 422 검증,
`/health` 확장, 얼굴 페이로드 결정)는 스키마 전면 재설계로 전부 해소됐다 — 얼굴은 원본
전량 전송 + 서버 78점 서브셋으로 결정.

| 항목 | 상태 |
| --- | --- |
| 모노레포·CI·API 계약 파이프라인 | 완료 |
| 손·얼굴·포즈 랜드마크 추출 | 완료 (웹) |
| 서버 — 스키마 재설계·ML 모듈(`app/ml/`)·엔드포인트 5종·아카이빙·진단 | 완료, pytest 57건 통과 |
| 모델 서빙 (30단어, small v2 z-off + 캘리브레이션) | 완료 — 체크포인트는 형제 레포 경로 참조 |
| 문장 변환 LLM (Qwen3-4B / vLLM 이식) | 코드 완료 — vLLM 서버는 레포 밖, 미가동 시 규칙 폴백. **실기기 지연 미측정** |
| 프론트 — 세그먼트 캡처·API 연동·SignFlow pill 큐(top-1 자동 확정)·하단 시트 정정·결과 화면(TTS) | 완료 (웹) |
| 카메라 프리뷰 (T-02) | **부분** — 프레이밍 가이드 박스·감지 안내·녹화 타이머는 반영, 실기기 세로 구도 확인 필요 |
| 청인 트랙 (STT → 수어 영상) | mock — 화면 흐름만 |
| `/phrases` 상황 문장 | 스켈레톤 — 빈 배열 |
| 발화 단위 촬영 + 서버 오프라인 분절 (MVP 이후 전환) | 미착수 |
| STT · 수어 아바타 영상 | 미착수 |

**사람이 직접 해야 하는 실측 항목** (에이전트가 대신할 수 없다)

- handedness 라벨 실측 — `HANDEDNESS_VERIFIED`가 false다. 서버 기하 매칭 덕에 차단
  요소는 아니지만, 아카이브 해석과 fallback 신뢰의 근거로 여전히 필요하다
- FPS 실측 — **손만 / 손+얼굴 / 손+얼굴+포즈** 세 조건을 각각, 백엔드(GPU/CPU) 표기와 함께
  기록한다. 체감 지연이 생기면 `FACE_DETECT_EVERY_N_FRAMES`부터 검토(현재 1 = 미측정 기본값)
- 실기기 프레이밍 — 왼손 그립·서서·팔 피로도. **얼굴과 양어깨가 프레임에 들어오는지** 포함.
  어깨는 정규화 기준이라 안 잡히면 서버가 `low_quality`(`shoulders_not_visible`)로 거절한다
- 그립손 엄지 도달성 — 단어당 "누르는 동안 캡처" 버튼을 한 손 그립으로 조작할 수 있는지
- https 서빙 — 실기기 브라우저는 localhost 밖에서 `getUserMedia`에 https가 필요하다.
  실기기 웹 시연 전에 서빙 방법을 정해야 한다
- 라벨된 실사용 평가셋 확보 — 아카이브에 정답 라벨이 없어 v2의 실사용 정답률이 미지다.
  feedback 엔드포인트(T-26) 채택 또는 아카이브 수동 라벨링으로 확보한다. reject 임계(0.45)
  재조정과 라운드3(tasks-vision 재추출) 착수 여부를 판정하는 기준 데이터다

## 미확정 항목 다루기

인식 정확도 목표치, 허용 지연 시간(ms), 후보 개수 N(현재 top_k=4 — 후보 시트 2×2 그리드에 맞춘 값), reject 임계(현재 0.45 —
캘리브레이션 후 기준), 세그먼트 프레임 수 범위, 프리롤/포스트롤 시간은 사용자 검증과 실측
전까지 확정되지 않은
값이다. 코드에는 임시값임을 주석으로 명시해 두었다(`app/core/config.py`,
`capture/config.ts`). 그럴듯한 숫자를 임의로 채워 넣고 확정된 것처럼 코드나 문서에 박아두지
말 것. 값이 필요하면 프로토타입용 임시값임을 명시하고, 근거가 없다는 사실을 드러낸다.
