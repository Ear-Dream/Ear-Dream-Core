# Ear Dream — Android WebView 셸

웹 번들(`pnpm build:web-mobile` 의 `dist/`)을 APK 안에 담아 WebView 로 여는 최소 래퍼다.
네이티브 이식이 **아니다** — 화면·상태·인식·네트워크는 전부 웹 번들 안에 그대로 있다.

## 왜 이 방식인가

네이티브 RN 빌드는 인식 경로를 통째로 잃는다. MediaPipe tasks-vision 이 브라우저 WASM
기반이라 `useLandmarker` 계열에 네이티브 구현이 존재하지 않고, 무엇보다 `live_y_scale` ·
`debias_alpha` · `reject_threshold` · `AR_TRAIN` 이 전부 **브라우저 tasks-vision 으로 찍은
라이브 데이터에 피팅된 값**이라 추출기를 바꾸면 모델이 그대로여도 근거가 조용히 무효화된다
(레포 CLAUDE.md 「모바일은 네이티브가 아니라 모바일 웹으로 간다」).

WebView 셸은 그 값들을 건드리지 않는다. 브라우저에서 돌던 것이 그대로 돈다.

## 얻는 것 · 잃는 것

**얻는 것**

- 설치형 앱. ngrok 링크를 열 필요가 없다.
- **웹 애셋 약 68MB 가 APK 안에 있다** — 터널을 오가는 것이 API 호출뿐이라, 첫 로드
  19MB 를 매번 내려받던 비용이 사라진다. 터널 없이 LAN 으로 노트북을 직접 부를 수도 있다.
- 화면 꺼짐 방지가 확실해진다 (웹 Wake Lock API 는 지원이 갈린다).
- 시스템 글꼴 배율의 영향을 받지 않는다 (`textZoom = 100`).

**잃는 것**

- **STT.** Android System WebView 에는 `SpeechRecognition` 구현이 실려 있지 않다
  (Chrome 앱에는 있다). 앱은 키보드 입력 폴백으로 내려간다 — 고장이 아니다.
- `speechSynthesis` 도 기대할 수 없다. 서버 TTS(`/speech`)가 꺼져 있으면 소리가 안 난다.
- `CompressionStream`(요청 gzip) · WebGL2(GPU delegate) 유무는 **기기의 WebView 버전에
  달렸다**. WebView 는 Play 스토어로 갱신되므로 OS 버전보다 그쪽이 중요하다.
  실제로 무엇이 잡혔는지는 개발 화면 HUD 로 읽는다(아래).

## 빌드

```
pnpm build:web-mobile        # 웹 내보내기 (dist/)
pnpm build:apk               # dist → assets/web 복사 후 assembleDebug
```

`pnpm build:apk` 가 하는 일: `.gz` 사이드카를 뺀 채 `dist/` 를 하드링크로 옮기고, JDK 17~21 과
Android SDK 를 찾아 `./gradlew assembleDebug` 를 돌린다. 산출물 경로와 `adb install` 명령을
마지막에 출력한다.

서버 주소를 APK 에 미리 굽고 싶으면:

```
pnpm build:apk --api https://xxxx.ngrok-free.app
```

굽지 않으면 앱이 **첫 실행 때 물어본다**. 어느 쪽이든 앱 안에서 바꿀 수 있다 — 터널 주소는
세션마다 바뀌는데 그때마다 68MB APK 를 다시 만들 수는 없기 때문이다.

## 앱 안에서 (셸 메뉴)

**뒤로가기** 를 누르면 셸 메뉴가 열린다.

| 항목 | 내용 |
| --- | --- |
| 서버 주소 변경 | 저장 후 다시 로드한다. 주소는 문서를 내보내는 시점에 주입되므로 새로고침이 필요하다 |
| 새로고침 | 웹 번들 다시 로드 |
| 개발 화면 (?dev=1) | FPS · 실제 delegate · 카메라 계측 · 햅틱 진단 패널 |
| 종료 | |

화면 위에 버튼을 얹지 않은 이유는 앱 자신의 AppBar 와 겹치고 카메라 세로 화각을 먹기
때문이다. 이 웹앱은 SPA 라 히스토리를 쌓지 않으므로 뒤로가기는 어차피 "종료" 한 가지
뜻뿐이었다 — 캡처 도중 실수로 눌러 끝나는 것보다 확인을 받는 편이 낫다.

## 서버 붙이기

웹 애셋이 이미 APK 안에 있으므로 서버는 API 만 있으면 된다.

```
pnpm dev:api                                  # FastAPI :8000
```

- **LAN 직결** — 앱에 `http://<노트북 IP>:8000` 을 넣는다. 터널이 필요 없다.
- **터널** — `ngrok http 8000` 후 그 https 주소를 넣는다.

`serve-mobile` 은 이 경로에 필요 없다. 그건 웹을 http 로 **내보내기** 위한 것이고, 여기서는
웹이 앱 안에 있다.

## 알아 둘 것

- **`file://` 로 열면 안 된다.** secure context 가 아니라서 `navigator.mediaDevices` 자체가
  존재하지 않는다 — 카메라·마이크가 통째로 죽는다. 그래서 `WebViewAssetLoader` 로
  가상 https 오리진(`appassets.androidplatform.net`)에서 연다.
- **`onPermissionRequest` 가 필수다.** 앱 권한이 있어도 이걸 구현하지 않으면 WebView 가
  카메라 요청을 그냥 거부한다. Chrome 에서 되던 것이 WebView 에서 안 되는 대표적 이유다.
- **평문 http 를 열어 뒀다** (`usesCleartextTraffic` + `MIXED_CONTENT_ALWAYS_ALLOW`).
  LAN 직결 데모를 위한 결정이고, 스토어 배포를 하게 되면 둘 다 되돌리고 https API 만 쓴다.
- **release 빌드는 서명하지 않는다.** 서명되지 않은 APK 는 설치되지 않으므로 지금은
  `assembleDebug` 만 쓴다 — keystore 관리는 실제 배포를 정할 때의 문제다.
- 폰 안의 콘솔은 `chrome://inspect` 로 읽는다 (debug 빌드에서 활성화돼 있다).

## 구조

```
app/src/main/java/com/eardream/shell/
  MainActivity.kt          WebView 설정 · 권한 게이트 · 셸 메뉴 · 화면 꺼짐 방지
  WebAssetPathHandler.kt   assets/web/ 를 가상 오리진으로 내보내기 (MIME · 서버 주소 주입)
  ApiBaseUrlStore.kt       서버 주소 보관 (저장값 > 빌드 기본값 > 물어보기)
```
