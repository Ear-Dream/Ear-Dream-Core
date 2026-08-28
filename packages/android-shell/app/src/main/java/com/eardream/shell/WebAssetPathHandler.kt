package com.eardream.shell

import android.content.res.AssetManager
import android.util.Log
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets

/**
 * `assets/web/` 에 담긴 Expo 웹 내보내기(`pnpm build:web-mobile` 의 dist)를 가상 오리진으로
 * 내보낸다.
 *
 * ## 왜 기본 AssetsPathHandler 를 쓰지 않는가
 *
 * 두 가지가 필요해서다.
 *
 * 1. **MIME 타입** — 기본 핸들러는 확장자 추측에 기대는데 `.wasm` 을 모른다. MediaPipe 는
 *    `WebAssembly.instantiateStreaming` 으로 받으므로 `application/wasm` 이 아니면 스트리밍
 *    경로가 깨진다(폴백이 있더라도 그쪽은 통째로 버퍼링한다). `.task` 도 마찬가지다.
 * 2. **index.html 에 서버 주소 주입** — 앱 코드가 모듈 평가 시점에 서버 주소를 읽으므로
 *    (`src/api.ts`), 페이지 로드 후 `evaluateJavascript` 로 넣으면 이미 늦다. 문서를
 *    내보내는 이 지점에서 `<head>` 바로 뒤에 끼워 넣으면 경합이 없다.
 *
 * ## 캐시를 끄는 이유
 *
 * 전부 `no-store` 다. 파일이 이미 기기 안에 있는데 WebView 의 HTTP 캐시에 또 넣으면
 * **77MB 를 한 벌 더 쓰는 것**뿐이고 얻는 게 없다.
 */
class WebAssetPathHandler(
    private val assets: AssetManager,
    /** 매번 읽는다 — 사용자가 앱 안에서 주소를 바꾸고 새로고침하면 그 값이 반영돼야 한다. */
    private val apiBaseUrl: () -> String,
) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val clean = path.trimStart('/').ifEmpty { INDEX }

        // `..` 로 assets/web/ 밖을 볼 수 없게 한다. AssetManager 가 알아서 막아 주지 않는다.
        if (clean.contains("..")) return errorResponse(403, "Forbidden", "경로가 올바르지 않습니다.")

        // 상대경로로 나간 API 호출을 여기서 잡는다. 그냥 두면 아래 SPA 폴백이 index.html 을
        // 돌려줘 "JSON 을 기대했는데 HTML 이 왔다" 는 알아보기 힘든 에러가 된다.
        if (isApiPath(clean)) return apiMisrouted()

        if (clean == INDEX) return serveIndex()

        return serveAsset(clean) ?: run {
            // SPA 폴백 — 확장자가 없는 알 수 없는 경로는 문서 요청으로 본다
            // (scripts/serve-mobile.mjs 와 같은 규칙).
            if (clean.substringAfterLast('/').contains('.')) {
                errorResponse(404, "Not Found", "앱 자산에 없는 파일입니다: $clean")
            } else {
                serveIndex()
            }
        }
    }

    /** index.html 을 읽어 `<head>` 바로 뒤에 서버 주소 주입 스크립트를 끼운다. */
    private fun serveIndex(): WebResourceResponse {
        val html = try {
            assets.open("$WEB_ROOT/$INDEX").use { it.readBytes().toString(StandardCharsets.UTF_8) }
        } catch (error: IOException) {
            Log.e(TAG, "assets/web/index.html 이 없다", error)
            return errorResponse(
                500,
                "Internal Error",
                "웹 자산이 APK 에 들어 있지 않습니다. `pnpm build:apk` 로 다시 만드세요.",
            )
        }

        val injected = html.replaceFirst("<head>", "<head>${injectionScript()}")
        return response(
            mimeType = "text/html",
            data = ByteArrayInputStream(injected.toByteArray(StandardCharsets.UTF_8)),
        )
    }

    private fun injectionScript(): String =
        "<script>globalThis.__EAR_DREAM_API_URL__=${jsString(apiBaseUrl())};</script>"

    private fun serveAsset(path: String): WebResourceResponse? {
        val assetPath = "$WEB_ROOT/$path"

        // noCompress 로 지정한 확장자는 openFd 로 길이를 알 수 있다. Content-Length 가 있으면
        // <video> 재생과 wasm 스트리밍이 안정적이다. 압축 저장된 자산은 여기서 IOException 이
        // 나므로 길이 없이 스트리밍한다 — 실패가 아니라 정상 분기다.
        val length: Long? = try {
            assets.openFd(assetPath).use { it.length }
        } catch (_: IOException) {
            null
        }

        val stream: InputStream = try {
            assets.open(assetPath)
        } catch (_: IOException) {
            return null
        }

        return response(mimeType = mimeTypeOf(path), data = stream, contentLength = length)
    }

    private fun apiMisrouted(): WebResourceResponse = errorResponse(
        502,
        "Bad Gateway",
        "서버 주소가 설정되지 않아 API 요청이 앱 안으로 돌아왔습니다. " +
            "뒤로가기 → 「서버 주소 변경」 에서 주소를 넣어 주세요.",
    )

    private fun errorResponse(status: Int, reason: String, detail: String): WebResourceResponse =
        response(
            mimeType = "application/json",
            data = ByteArrayInputStream(
                """{"detail":${jsString(detail)}}""".toByteArray(StandardCharsets.UTF_8),
            ),
            status = status,
            reason = reason,
        )

    private fun response(
        mimeType: String,
        data: InputStream,
        contentLength: Long? = null,
        status: Int = 200,
        reason: String = "OK",
    ): WebResourceResponse {
        val headers = mutableMapOf(
            // 기기 안에 이미 있는 파일이다. WebView 캐시에 복사본을 만들 이유가 없다.
            "Cache-Control" to "no-store",
        )
        if (contentLength != null) headers["Content-Length"] = contentLength.toString()

        return WebResourceResponse(mimeType, ENCODING, status, reason, headers, data)
    }

    private companion object {
        const val TAG = "EarDreamAssets"
        const val WEB_ROOT = "web"
        const val INDEX = "index.html"

        /**
         * 텍스트가 아닌 자산에도 이 값이 실린다. WebView 는 텍스트 계열 MIME 에만 인코딩을
         * 쓰므로 바이너리에는 영향이 없다.
         */
        const val ENCODING = "utf-8"

        /** scripts/serve-mobile.mjs 의 MIME 표와 같은 값을 쓴다 — 웹과 앱이 갈리면 안 된다. */
        val MIME_TYPES = mapOf(
            "html" to "text/html",
            "js" to "text/javascript",
            "mjs" to "text/javascript",
            "css" to "text/css",
            "json" to "application/json",
            "wasm" to "application/wasm",
            "task" to "application/octet-stream",
            "bin" to "application/octet-stream",
            "png" to "image/png",
            "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg",
            "gif" to "image/gif",
            "svg" to "image/svg+xml",
            "webp" to "image/webp",
            "ico" to "image/x-icon",
            "mp4" to "video/mp4",
            "ttf" to "font/ttf",
            "otf" to "font/otf",
            "woff" to "font/woff",
            "woff2" to "font/woff2",
            "txt" to "text/plain",
            "map" to "application/json",
        )

        fun mimeTypeOf(path: String): String =
            MIME_TYPES[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

        fun isApiPath(path: String): Boolean =
            path.startsWith("api/") || path == "health"

        /** JS/JSON 문자열 리터럴로 안전하게 감싼다. */
        fun jsString(value: String): String {
            val escaped = StringBuilder("\"")
            for (char in value) {
                when {
                    char == '"' -> escaped.append("\\\"")
                    char == '\\' -> escaped.append("\\\\")
                    char == '\n' -> escaped.append("\\n")
                    char == '\r' -> escaped.append("\\r")
                    // `</script>` 가 문자열 안에서 문서를 끊지 못하게 한다.
                    char == '<' -> escaped.append("\\u003c")
                    char.code < 0x20 -> escaped.append("\\u%04x".format(char.code))
                    else -> escaped.append(char)
                }
            }
            return escaped.append('"').toString()
        }
    }
}
