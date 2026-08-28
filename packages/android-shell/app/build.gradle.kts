plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * 기본 서버 주소. 비워 두면 앱이 첫 실행 때 물어본다.
 *
 *   ./gradlew assembleDebug -PearDream.apiBaseUrl=https://xxxx.ngrok-free.app
 *
 * 주소를 여기 박아도 앱 안에서 바꿀 수 있다(뒤로가기 → 「서버 주소 변경」) — 터널 주소가
 * 세션마다 바뀌기 때문에 APK 재빌드를 강제하지 않는 것이 이 셸의 전제다.
 */
val defaultApiBaseUrl: String = (project.findProperty("earDream.apiBaseUrl") as String?).orEmpty()

android {
    namespace = "com.eardream.shell"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.eardream.shell"
        // 8.0. WebView 는 Play 스토어로 갱신되므로 OS 버전보다 WebView 버전이 중요하다.
        minSdk = 26
        // 35 로 올리면 edge-to-edge 강제가 붙어 레이아웃을 다시 봐야 한다. 지금은 34 에 둔다.
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "DEFAULT_API_BASE_URL", "\"$defaultApiBaseUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            // 데모·실측 경로다. chrome://inspect 로 폰 안의 콘솔을 읽으려면 이 빌드여야 한다.
            isMinifyEnabled = false
        }
        release {
            // ⚠️ 서명 키가 없으면 release APK 는 설치되지 않는다. 지금은 debug 로만 낸다
            //    (keystore 관리는 배포를 실제로 할 때 정할 문제다).
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    androidResources {
        /**
         * ⚠️ **밑줄로 시작하는 디렉토리를 버리지 않게 한다.**
         *
         * aapt 의 기본 자산 무시 패턴에는 `<dir>_*` 가 들어 있어서 `_` 로 시작하는 디렉토리를
         * 통째로 APK 에서 뺀다. Expo 웹 내보내기는 **JS 번들 전체를 `_expo/` 아래**에 넣으므로,
         * 기본값이면 index.html 만 실리고 앱 코드가 사라진다 — 빌드는 성공하고 앱은 뜨는데
         * 화면만 비는, 원인을 찾기 어려운 형태로 나타난다(실제로 한 번 겪었다).
         *
         * 아래 목록은 AGP 기본값에서 `<dir>_*` 하나만 뺀 것이다.
         */
        ignoreAssetsPatterns.clear()
        ignoreAssetsPatterns += listOf(
            "!.svn", "!.git", "!.gitignore", "!.ds_store", "!*.scc", ".*",
            "!CVS", "!thumbs.db", "!picasa.ini", "!*~",
        )

        /**
         * APK 안에서 다시 압축하지 않을 확장자.
         *
         * `.task`(MediaPipe 모델 17MB)와 `.bin`(수어 시퀀스 28MB)은 이미 압축된 바이너리라
         * 다시 압축해도 거의 안 줄고, **압축해 두면 AssetManager 가 열 때마다 통째로 풀어야
         * 해서 첫 로딩이 느려진다**. wasm·js 는 잘 줄어들므로 그대로 압축시킨다.
         */
        noCompress += listOf("task", "bin", "mp4")
    }
}

dependencies {
    // WebViewAssetLoader (가상 https 오리진) 와 WebViewClientCompat 이 여기 있다.
    implementation("androidx.webkit:webkit:1.12.1")
    // AlertDialog · 런타임 권한 런처.
    implementation("androidx.appcompat:appcompat:1.7.0")
}
