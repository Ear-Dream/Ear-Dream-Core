package com.eardream.shell

import android.content.Context

/**
 * API 서버 주소 보관.
 *
 * **왜 빌드에 박지 않고 저장하는가** — 이 셸의 웹 자산은 APK 안에 있지만 API 는 밖에 있고,
 * 그 주소는 터널(ngrok) 세션마다 바뀐다. 주소를 번들이나 BuildConfig 에만 두면 주소가
 * 바뀔 때마다 77MB APK 를 다시 만들어 다시 설치해야 한다 — 데모 당일에 못 할 일이다.
 *
 * 그래서 우선순위가 셋이다: 저장된 값 > 빌드 기본값(`-PearDream.apiBaseUrl`) > 없음(물어본다).
 */
class ApiBaseUrlStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 지금 쓸 주소. 비어 있으면 아직 정해지지 않은 것이다. */
    var value: String
        get() = prefs.getString(KEY, null) ?: BuildConfig.DEFAULT_API_BASE_URL
        set(newValue) {
            prefs.edit().putString(KEY, normalize(newValue)).apply()
        }

    val isConfigured: Boolean get() = value.isNotEmpty()

    private companion object {
        const val PREFS = "ear_dream_shell"
        const val KEY = "api_base_url"

        /**
         * 끝의 `/` 를 떼고, 스킴이 없으면 http 로 본다.
         *
         * 스킴 기본값이 https 가 아닌 이유: 손으로 넣는 주소는 대부분 LAN 의
         * `192.168.x.x:8000` 이다. 터널 주소는 붙여넣기라 스킴이 이미 들어 있다.
         */
        fun normalize(raw: String): String {
            val trimmed = raw.trim().trimEnd('/')
            if (trimmed.isEmpty()) return ""
            return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                trimmed
            } else {
                "http://$trimmed"
            }
        }
    }
}
