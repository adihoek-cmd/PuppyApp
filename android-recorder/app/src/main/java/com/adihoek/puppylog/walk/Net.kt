package com.adihoek.puppylog.walk

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object Config {
    // Same public web config the Puppy Log PWA uses (index.html).
    const val API_KEY = "AIzaSyCNos9E0IfVemiQhrKfbcUnSXPLtLkzBqQ"
    const val PROJECT = "puppy-log-b5560"
    // Sent so a referrer-restricted API key still accepts our calls.
    const val REFERER = "https://adihoek-cmd.github.io/PuppyApp/"
    const val WORKER = "https://puppy-strava.adi-hoek.workers.dev"

    const val WARN_MIN = 120      // "walk still running?" notification
    const val AUTO_STOP_MIN = 150 // stop by itself unless extended
}

class HttpResult(val code: Int, val body: String) {
    val ok get() = code in 200..299
}

object Net {
    fun request(method: String, url: String, body: ByteArray? = null, headers: Map<String, String> = emptyMap()): HttpResult {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = if (method == "PATCH") "POST" else method
            if (method == "PATCH") c.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.setRequestProperty("Referer", Config.REFERER)
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            if (body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(body) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return HttpResult(code, text)
        } finally {
            c.disconnect()
        }
    }

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
