package com.eardream.shell

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

/**
 * 이어드림 웹 번들을 담은 WebView 셸.
 *
 * ## 이 셸이 하는 일은 넷뿐이다
 *
 * 1. APK 안의 웹 자산을 **가상 https 오리진**으로 내보낸다 — `file://` 은 secure context 가
 *    아니라서 `navigator.mediaDevices` 자체가 존재하지 않는다. 카메라·마이크가 통째로
 *    죽으므로 이건 선택이 아니라 필수다.
 * 2. WebView 의 **권한 게이트**를 넘긴다 — 앱 권한이 있어도 `onPermissionRequest` 를 구현하지
 *    않으면 WebView 가 거부한다. Chrome 에서 되던 것이 WebView 에서 안 되는 대표적인 이유다.
 * 3. 서버 주소를 **런타임에 정하게** 한다 (ApiBaseUrlStore).
 * 4. 화면이 꺼지지 않게 한다 — 캡처 중 화면이 잠들면 카메라 트랙이 멈춰 세그먼트가 끊긴다.
 *    웹의 Wake Lock API 는 지원이 갈리므로 여기서 확실하게 잡는다.
 *
 * 그 밖의 것은 하지 않는다. 화면·상태·네트워크는 전부 웹 번들 안에 있고, 이 파일이 무언가를
 * 더 알기 시작하면 로직이 두 벌이 된다.
 *
 * ## 알려진 한계 (WebView 이기 때문에 생기는 것)
 *
 * - **STT 가 없다.** Android System WebView 에는 `SpeechRecognition` 구현이 실려 있지 않다
 *   (Chrome 앱에는 있다). 앱은 키보드 입력 폴백으로 내려간다 — 고장이 아니다.
 * - `speechSynthesis` 도 기대할 수 없다. 서버 TTS(`/speech`)가 꺼져 있으면 소리가 안 난다.
 * - CompressionStream · WebGL2(GPU delegate) 유무는 **기기의 WebView 버전에 달렸다**.
 *   실제로 무엇이 잡혔는지는 개발 화면(뒤로가기 → 「개발 화면」)의 HUD 로 읽는다.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var apiBaseUrl: ApiBaseUrlStore
    private lateinit var assetLoader: WebViewAssetLoader

    /** 권한 대화상자를 띄우는 동안 붙잡아 두는 WebView 요청. */
    private var pendingPermissionRequest: PermissionRequest? = null

    /**
     * 지금 떠 있는 셸 대화상자. Activity 가 먼저 죽으면 창이 샌다(WindowLeaked) —
     * 설정 변경으로 재생성될 때 실제로 발생한다.
     */
    private var shellDialog: AlertDialog? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        val request = pendingPermissionRequest ?: return@registerForActivityResult
        pendingPermissionRequest = null

        if (granted.values.all { it }) {
            request.grant(request.resources)
        } else {
            // 거부는 웹으로 그대로 전달한다 — 앱이 "카메라를 켤 수 없다" 안내를 갖고 있다.
            request.deny()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 캡처 중 화면 꺼짐 방지 (위 4번).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        apiBaseUrl = ApiBaseUrlStore(this)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebAssetPathHandler(assets) { apiBaseUrl.value })
            .build()

        webView = createWebView()
        setContentView(
            FrameLayout(this).apply {
                addView(
                    webView,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            },
        )

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = showShellMenu()
        })

        if (apiBaseUrl.isConfigured) {
            loadApp()
        } else {
            // 첫 실행. 주소를 모르면 앱을 띄워 봐야 모든 요청이 실패한다.
            showServerDialog(cancelable = false)
        }
    }

    private fun createWebView(): WebView = WebView(this).apply {
        setBackgroundColor(ContextCompat.getColor(context, R.color.brand_home_fallback))
        // 웹앱이 스스로 스크롤을 관리한다. 가장자리 글로우는 네이티브처럼 보이게만 방해한다.
        overScrollMode = View.OVER_SCROLL_NEVER
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true

            // 첫 화면 배경 영상이 자동재생되려면 필요하다. WebView 기본값이 이걸 막는다.
            mediaPlaybackRequiresUserGesture = false

            // 가상 오리진은 https 인데 API 는 LAN 평문일 수 있다 (AndroidManifest 의 ⚠️ 참고).
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

            // 자산은 전부 APK 안에 있다. 파일·콘텐츠 URL 을 열 이유가 없다.
            allowFileAccess = false
            allowContentAccess = false

            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false

            /**
             * 시스템 글꼴 크기를 따르지 않는다.
             *
             * 확정 디자인의 치수는 430pt 폭 기준으로 이미 한 단계씩 줄여 넣은 상태라
             * (CLAUDE.md 「Figma」), 여기에 시스템 배율이 곱해지면 라벨과 문장이 접힌다.
             * 접근성 배율을 존중하려면 웹 쪽 타이포 스케일부터 다시 잡아야 하는 별개 작업이다.
             */
            textZoom = 100
        }

        // 폰 안의 콘솔·네트워크를 chrome://inspect 로 읽는다. 아직 실측되지 않은 항목
        // (FPS, 실제 delegate, WebView 기능 유무)을 확인할 유일한 통로다.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webViewClient = ShellWebViewClient()
        webChromeClient = ShellWebChromeClient()
    }

    private fun loadApp(query: String = "") {
        webView.loadUrl("$APP_URL$query")
    }

    // ---------------------------------------------------------------- WebView 콜백

    private inner class ShellWebViewClient : WebViewClientCompat() {

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest,
        ): Boolean {
            // 우리 오리진 안의 이동은 WebView 가 처리한다.
            if (request.url.host == ASSET_DOMAIN) return false

            // 그 밖은 앱 안에 가둘 이유가 없다 — 시스템 브라우저로 넘긴다.
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                true
            } catch (_: ActivityNotFoundException) {
                true
            }
        }
    }

    private inner class ShellWebChromeClient : WebChromeClient() {

        /**
         * WebView 의 권한 게이트.
         *
         * 앱이 이미 권한을 갖고 있어도 이걸 구현하지 않으면 WebView 는 요청을 그냥 거부한다.
         * 앱 권한이 없으면 먼저 시스템 대화상자를 띄우고, 결과가 온 뒤에 grant/deny 한다.
         */
        override fun onPermissionRequest(request: PermissionRequest) {
            val needed = request.resources.mapNotNull(::androidPermissionFor).distinct()
            if (needed.isEmpty()) {
                request.deny()
                return
            }

            val missing = needed.filter {
                ContextCompat.checkSelfPermission(this@MainActivity, it) !=
                    PackageManager.PERMISSION_GRANTED
            }

            if (missing.isEmpty()) {
                request.grant(request.resources)
                return
            }

            pendingPermissionRequest = request
            permissionLauncher.launch(missing.toTypedArray())
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingPermissionRequest == request) pendingPermissionRequest = null
        }

        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
            Log.d(TAG, "[web] ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
            return true
        }
    }

    // ---------------------------------------------------------------- 셸 메뉴

    /**
     * 뒤로가기로 여는 셸 메뉴.
     *
     * **왜 뒤로가기인가** — 화면 위에 버튼을 얹으면 앱 자신의 AppBar 와 겹치고 카메라 화각을
     * 먹는다. 그리고 이 웹앱은 SPA 라 히스토리를 쌓지 않으므로 뒤로가기는 어차피 "앱 종료"
     * 한 가지 뜻뿐이다 — 캡처 도중 실수로 눌러 끝나는 것보다 확인을 한 번 받는 게 낫다.
     */
    private fun showShellMenu() {
        val items = arrayOf(
            getString(R.string.exit_dialog_change_server),
            getString(R.string.exit_dialog_reload),
            getString(R.string.exit_dialog_dev_screen),
            getString(R.string.exit_dialog_exit),
        )

        showDialog(
            AlertDialog.Builder(this)
                .setTitle(R.string.exit_dialog_title)
                .setItems(items) { _, which ->
                    when (which) {
                        0 -> showServerDialog(cancelable = true)
                        1 -> loadApp()
                        2 -> loadApp("?dev=1")
                        3 -> finish()
                    }
                }
                .setNegativeButton(R.string.server_dialog_cancel, null)
                .create(),
        )
    }

    private fun showServerDialog(cancelable: Boolean) {
        val input = EditText(this).apply {
            setText(apiBaseUrl.value)
            setSingleLine()
            setSelection(text.length)
        }

        val container = FrameLayout(this).apply {
            val margin = (24 * resources.displayMetrics.density).toInt()
            setPadding(margin, margin / 2, margin, 0)
            addView(input)
        }

        showDialog(
            AlertDialog.Builder(this)
                .setTitle(R.string.server_dialog_title)
                .setMessage(R.string.server_dialog_message)
                .setView(container)
                .setCancelable(cancelable)
                .setPositiveButton(R.string.server_dialog_save) { _, _ ->
                    apiBaseUrl.value = input.text.toString()
                    // 주소는 문서를 내보내는 시점에 주입되므로, 반영하려면 다시 읽어야 한다.
                    loadApp()
                }
                .apply { if (cancelable) setNegativeButton(R.string.server_dialog_cancel, null) }
                .create(),
        )
    }

    /** 한 번에 하나만 띄우고, Activity 와 수명을 묶는다. */
    private fun showDialog(dialog: AlertDialog) {
        shellDialog?.dismiss()
        shellDialog = dialog
        dialog.setOnDismissListener { if (shellDialog === dialog) shellDialog = null }
        dialog.show()
    }

    // ---------------------------------------------------------------- 수명주기

    override fun onDestroy() {
        shellDialog?.dismiss()
        shellDialog = null
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val TAG = "EarDreamShell"

        /** WebViewAssetLoader 의 기본 도메인. 실재하지 않는 주소라 외부로 새지 않는다. */
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val APP_URL = "https://$ASSET_DOMAIN/index.html"

        fun androidPermissionFor(resource: String): String? = when (resource) {
            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
            else -> null
        }
    }
}
