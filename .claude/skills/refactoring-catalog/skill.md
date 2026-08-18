---
name: refactoring-catalog
description: "코드 리팩토링 카탈로그. Martin Fowler 기반 리팩토링 패턴, 코드 스멜 탐지-리팩토링 매핑, SOLID 원칙 위반 판별, 복잡도 측정 기준을 제공하는 architecture-reviewer 확장 스킬. '리팩토링', '코드 스멜', 'SOLID 위반', '복잡도', '디자인 패턴', '코드 품질' 등 코드 구조 개선 리뷰 시 사용한다. 단, 코드 직접 수정이나 보안 분석은 이 스킬의 범위가 아니다."
---

# Refactoring Catalog — 코드 리팩토링 카탈로그

코드 스멜-리팩토링 매핑, SOLID 위반 판별, 복잡도 측정 레퍼런스.

## 대상 에이전트

- `architecture-reviewer` — 구조 리뷰와 리팩토링 제안에 적용
- `architect` — 설계 결정의 대안을 검토할 때 용어·기법 레퍼런스로 참조

원본 스킬은 `performance-analyst`도 대상으로 했으나 **이 레포에는 없다.**

## ⚠️ 이 프로젝트 적용 (Ear Dream) — 아래가 이 문서의 일반 카탈로그보다 우선한다

`CLAUDE.md`를 먼저 읽는다. `_workspace/01_refactoring_handoff.md`가 있으면 §2도 읽는다.

**이 레포에는 일부러 중복시킨 코드와 일부러 남긴 코드가 여럿이다.** 아래는 카탈로그의
스멜에 해당하는 것처럼 보이지만 **전부 의도된 설계**이고, 리팩토링하면 조용히 망가진다.

| 겉보기 스멜 | 실제 대상 | 왜 그대로 두는가 |
| --- | --- | --- |
| 중복 코드 | `services/sentence_llm/prompt.py`, `services/speech_tts/instructions.py`, `ml/keypoint_layout.py` | 다른 레포의 사본이고 그게 의도다. 공통화하면 원본과 갈라져 평가 수치가 무효가 된다 — 고치려면 원본과 동시에 + 버전 상수 갱신 |
| 중복 상수 | `features/voice/avatar/bodyLayout.ts`·`faceLayout.ts`의 kp130 인덱스 | 서버에서 못 가져온다. MediaPipe 런타임 인덱스와 대응하지 않고, 청인 트랙이 WASM 55MB를 받게 된다 |
| 죽은 코드 | LLM→규칙 폴백, `/speech` 503→브라우저 음성, STT→키보드, gzip→무압축 | 폴백이 요점이다. GPU 서버 없이 맥 단독으로 전 구간이 도는 근거 |
| 매직 넘버 | `core/config.py`의 `live_y_scale`·`debias_alpha`·`reject_threshold` | 브라우저 tasks-vision 라이브 데이터에 피팅된 값. 근거는 주석에 있다 |
| 매직 넘버 | 프리롤/포스트롤, `top_k`, 프레임 수 범위 | 미확정 임시값임이 주석에 명시돼 있다. 확정된 값처럼 정리하지 말 것 |
| 클라이언트 전처리 | `avatar/usePlayback.ts`의 단어 사이 좌표 보간 | 모델로 가지 않고 화면에만 그려진다 — 설계 결정 1 위반이 아니다 |

**적용 대상이 없는 절**:

- **LSP·ISP** — 이 레포의 상속 계층은 ABC 1개(`SentenceGenerator`)와 `nn.Module` 모델
  정의뿐이고, 앱에는 클래스 컴포넌트가 0개다. 상속이 없는 곳에서 위반을 찾지 말 것
- **디자인 패턴 도입** — 서버는 함수 + `@dataclass`, 앱은 훅이다. Strategy·Factory·
  State 도입을 권하기 전에 "지금 무엇이 아픈가"를 먼저 밝힌다. MVVM·Repository·DI
  컨테이너는 이 앱 규모에 부채다
- **DIP의 "구체 클래스 직접 생성"** — FastAPI `Depends`와 모듈 레벨 싱글턴이 이 레포의
  주입 방식이다. 테스트가 대체할 수 있으면(`tests/`의 MockTransport·가짜 생성기) 충족으로 본다

**한계값 적용 시 주의**: 아래 「권장 한계값」의 줄 수 기준은 로직 파일에만 적용한다.
`constants/strings.ts`, `core/config.py`, `ml/keypoint_layout.py` 같은 **데이터·상수 파일**은
길어도 스멜이 아니다.

## 코드 스멜 → 리팩토링 매핑

### 크기 관련 스멜

| 코드 스멜 | 징후 | 리팩토링 기법 |
|----------|------|-------------|
| **긴 메서드** (Long Method) | 20줄+ | Extract Method, Replace Temp with Query |
| **거대 클래스** (Large Class) | 300줄+ 또는 10+ 필드 | Extract Class, Extract Subclass |
| **긴 파라미터 목록** | 4개+ 파라미터 | Introduce Parameter Object, Builder Pattern |
| **데이터 뭉치** (Data Clump) | 같은 필드 그룹이 반복 | Extract Class |
| **원시 타입 집착** (Primitive Obsession) | 도메인 개념을 원시 타입으로 | Value Object, Enum |

### 구조 관련 스멜

| 코드 스멜 | 징후 | 리팩토링 기법 |
|----------|------|-------------|
| **Feature Envy** | 다른 클래스의 데이터를 과도하게 사용 | Move Method |
| **Data Class** | getter/setter만 있는 클래스 | Move behavior into class |
| **기능 분산** (Shotgun Surgery) | 하나의 변경이 여러 클래스에 영향 | Move Method/Field, Inline Class |
| **산발적 변경** (Divergent Change) | 한 클래스가 여러 이유로 변경 | Extract Class (SRP) |
| **중복 코드** | 동일/유사 코드 반복 | Extract Method, Template Method |
| **중개자** (Middle Man) | 위임만 하는 클래스 | Remove Middle Man, Inline Class |
| **부적절한 친밀** (Inappropriate Intimacy) | 클래스 간 과도한 결합 | Move Method/Field, Extract Class |
| **Switch/If 체인** | 긴 분기문 | Replace Conditional with Polymorphism, Strategy |
| **상속 거부** (Refused Bequest) | 상속받고 사용하지 않는 메서드 | Replace Inheritance with Delegation |
| **주석 의존** (Comments) | 복잡한 로직을 주석으로 설명 | Extract Method (자기 문서화 코드) |

## SOLID 원칙 위반 판별

### S — Single Responsibility Principle
| 위반 신호 | 판별 기준 | 리팩토링 |
|----------|----------|---------|
| 클래스 이름에 "And", "Manager" | 여러 책임 암시 | Extract Class |
| 변경 이유 2개 이상 | "X가 바뀌면 이 클래스도 바뀌고, Y가 바뀌어도 이 클래스가 바뀐다" | 책임별 클래스 분리 |
| import가 매우 다양 | DB, HTTP, UI, 로그 모두 import | 레이어 분리 |

### O — Open/Closed Principle
| 위반 신호 | 판별 기준 | 리팩토링 |
|----------|----------|---------|
| 새 유형 추가 시 switch/if 수정 | 기존 코드 변경 필수 | Strategy Pattern, 다형성 |
| 하드코딩된 분기 | 새 조건마다 코드 추가 | Plugin/Registry 패턴 |

### L — Liskov Substitution Principle (이 레포 해당 없음 — 상단 절 참조)
| 위반 신호 | 판별 기준 | 리팩토링 |
|----------|----------|---------|
| 자식 클래스에서 예외를 던지는 오버라이드 | `NotImplementedError`, `UnsupportedOperationException` | 인터페이스 분리, 상속→조합 |
| 타입 체크 후 캐스팅 | `instanceof` / `typeof` 분기 | 다형성 재설계 |

### I — Interface Segregation Principle (이 레포 해당 없음 — 상단 절 참조)
| 위반 신호 | 판별 기준 | 리팩토링 |
|----------|----------|---------|
| 비어있는 인터페이스 구현 | `pass`, `{}`, `noop` | 인터페이스 분리 |
| "뚱뚱한" 인터페이스 | 10개+ 메서드 | Role Interface로 분리 |

### D — Dependency Inversion Principle
| 위반 신호 | 판별 기준 | 리팩토링 |
|----------|----------|---------|
| 구체 클래스 직접 생성 | `new ConcreteService()` 하드코딩 | Dependency Injection |
| 상위 모듈이 하위 모듈 import | 비즈니스 로직이 DB 라이브러리 직접 사용 | Interface/Port 추상화 |

## 복잡도 측정 기준

### 순환 복잡도 (Cyclomatic Complexity)
분기점(if/else/switch/for/while/catch) 수 + 1

| 점수 | 복잡도 | 액션 |
|------|--------|------|
| 1~5 | 낮음 | 적절 |
| 6~10 | 중간 | 리뷰 시 주의 |
| 11~20 | 높음 | 리팩토링 권장 |
| 21+ | 매우 높음 | 리팩토링 필수 |

### 인지 복잡도 (Cognitive Complexity)
사람이 코드를 이해하는 난이도. 중첩이 깊을수록 가중치 증가.

| 요소 | 기본 증분 | 중첩 보너스 |
|------|----------|-----------|
| if/else/switch | +1 | +중첩 레벨 |
| for/while/do | +1 | +중첩 레벨 |
| catch | +1 | +중첩 레벨 |
| break/continue to label | +1 | - |
| 논리 연산자 체인 (&&, ||) | +1 | - |
| 재귀 호출 | +1 | - |

### 권장 한계값
| 메트릭 | 메서드/함수 | 클래스/파일 |
|--------|-----------|-----------|
| 코드 줄 수 | 20줄 이내 | 300줄 이내 |
| 순환 복잡도 | 10 이하 | - |
| 인지 복잡도 | 15 이하 | - |
| 파라미터 수 | 4개 이하 | - |
| 중첩 깊이 | 3레벨 이하 | - |
| 의존성 수 | - | 10개 이하 |

## 디자인 패턴 적용 가이드

### 스멜→패턴 매핑

| 문제 상황 | 적용 패턴 | 효과 |
|----------|----------|------|
| 조건문으로 행동 분기 | **Strategy** | OCP 준수, 새 행동 쉽게 추가 |
| 객체 생성 로직 복잡 | **Factory Method/Builder** | 생성 로직 캡슐화 |
| 알고리즘 골격은 같고 세부만 다름 | **Template Method** | 중복 제거, 변경점 격리 |
| 상태에 따라 동작 변경 | **State** | 조건문 제거, 상태 전이 명확화 |
| 여러 객체에 이벤트 전파 | **Observer** | 느슨한 결합 |
| 호환되지 않는 인터페이스 통합 | **Adapter** | 기존 코드 수정 없이 통합 |
| 복잡한 서브시스템 단순화 | **Facade** | 인터페이스 단순화 |
| 객체에 동적으로 기능 추가 | **Decorator** | 상속 없이 기능 확장 |

## 리팩토링 우선순위 결정

### 영향도-난이도 매트릭스

| | 난이도 낮음 | 난이도 높음 |
|--|-----------|-----------|
| **영향도 높음** | 즉시 수행 | 계획 수립 후 수행 |
| **영향도 낮음** | 시간 될 때 | 보류 (비용 대비 효과 낮음) |

### 리팩토링 제안 포맷
```
[심각도] 코드 스멜: [스멜 이름]
위치: [파일:줄]
현재 상태: [문제 설명]
리팩토링: [기법 이름]
기대 효과: [어떻게 개선되는지]
예상 난이도: [낮음/중간/높음]
```
