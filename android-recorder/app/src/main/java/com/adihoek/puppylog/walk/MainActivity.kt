package com.adihoek.puppylog.walk

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.View
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import java.io.File

/**
 * Puppy Log as one Android app: the live Puppy Log web app (same URL as in the browser,
 * so web updates arrive as before) plus native GPS walk recording.
 *
 * The page sees `window.PuppyNative` and uses it for: starting the GPS recording when you
 * tap Walk, the bag alert notification, saving backup / calendar files, copying the family
 * code, and opening the native "Walk recording & Strava" screen.
 *
 * puppylogwalk://start-walk opens the app and logs + records a walk (same as the web
 * ?action=start-walk link, which still works in the browser without GPS).
 */
class MainActivity : Activity() {

    companion object {
        const val HOME = "https://adihoek-cmd.github.io/PuppyApp/"
        private const val HOST = "adihoek-cmd.github.io"
        private const val CH_BAGS = "bags"
        private const val REQ_WALK = 11
        private const val REQ_NOTIFY = 12
    }

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())
    private var pendingWalk: Array<String>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CH_BAGS, "Poop bag alerts", NotificationManager.IMPORTANCE_DEFAULT))

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.userAgentString = web.settings.userAgentString + " PuppyLogApp/2"
        web.addJavascriptInterface(Bridge(), "PuppyNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == HOST && (u.scheme == "https" || u.scheme == "http")) return false
                // Anything else (Strava, mail, other sites) opens outside the app.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) view.loadDataWithBaseURL(null, offlinePage(), "text/html", "utf-8", null)
            }
        }

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#FFF7ED"))
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        // Keep the page clear of the status / navigation bars (Android 15 draws edge-to-edge).
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(root)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.parseColor("#FFF7ED")
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(urlFor(intent))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.data?.scheme == "puppylogwalk") web.loadUrl(urlFor(intent))
    }

    private fun urlFor(i: Intent?): String =
        if (i?.data?.scheme == "puppylogwalk" && i.data?.host == "start-walk") "$HOME?action=start-walk" else HOME

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    private fun offlinePage() = """
        <html><body style="font-family:sans-serif;background:#FFF7ED;color:#44403C;text-align:center;padding:40px">
        <div style="font-size:44px">🐶</div><h3>No connection</h3>
        <p>Puppy Log needs the internet to load.</p>
        <p><a href="$HOME" style="color:#B45309;font-weight:bold">Try again</a></p></body></html>
    """.trimIndent()

    // ---------------------------------------------------------------- walk start

    private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun startWalk(eventId: String, family: String, by: String, ts: Long) {
        if (eventId.isEmpty() || family.isEmpty()) return
        val p = Prefs(this)
        p.family = family
        if (by.isNotBlank()) p.who = by
        if (!hasLocation()) {
            pendingWalk = arrayOf(eventId, family, by, ts.toString())
            val list = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= 33) list += Manifest.permission.POST_NOTIFICATIONS
            requestPermissions(list.toTypedArray(), REQ_WALK)
            return
        }
        WalkService.start(this, eventId, family, ts)
        Toast.makeText(this, "🐾 Recording the route", Toast.LENGTH_SHORT).show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_WALK) return
        val w = pendingWalk ?: return
        pendingWalk = null
        if (hasLocation()) startWalk(w[0], w[1], w[2], w[3].toLong())
        else Toast.makeText(this, "Walk logged without a route (no location permission).", Toast.LENGTH_LONG).show()
    }

    // ---------------------------------------------------------------- files

    /** Saves to Downloads; for calendar files also opens them so the calendar app can add the reminder. */
    private fun saveFile(name: String, mime: String, text: String, open: Boolean) {
        try {
            val uri: Uri
            if (Build.VERSION.SDK_INT >= 29) {
                val v = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                }
                uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)
                    ?: throw IllegalStateException("no Downloads")
                contentResolver.openOutputStream(uri)!!.use { it.write(text.toByteArray()) }
            } else {
                val f = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name)
                f.writeText(text)
                uri = Uri.fromFile(f)
            }
            if (open && Build.VERSION.SDK_INT >= 29) {
                val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                runCatching { startActivity(i) }.onFailure { toast("Saved $name to Downloads") }
            } else toast("Saved $name to Downloads")
        } catch (e: Exception) {
            toast("Couldn't save the file: ${e.message}")
        }
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    // ---------------------------------------------------------------- JS bridge

    /** Methods the page can call as window.PuppyNative.xxx(). They arrive off the main thread. */
    inner class Bridge {
        @JavascriptInterface fun isApp(): Boolean = true

        @JavascriptInterface fun startWalk(eventId: String, family: String, by: String, ts: String) {
            main.post { this@MainActivity.startWalk(eventId, family, by, ts.toLongOrNull() ?: System.currentTimeMillis()) }
        }

        /** Event id of the walk being GPS-recorded on this phone, or "". */
        @JavascriptInterface fun recordingEvent(): String = Prefs(this@MainActivity).activeEvent

        @JavascriptInterface fun stopWalk() {
            main.post { WalkService.send(this@MainActivity, WalkService.ACTION_STOP) }
        }

        @JavascriptInterface fun openSettings() {
            main.post { startActivity(Intent(this@MainActivity, SettingsActivity::class.java)) }
        }

        @JavascriptInterface fun askNotifications() {
            if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                main.post { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY) }
            }
        }

        @JavascriptInterface fun notify(title: String, body: String) {
            val open = PendingIntent.getActivity(this@MainActivity, 0, Intent(this@MainActivity, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            getSystemService(NotificationManager::class.java).notify(31,
                Notification.Builder(this@MainActivity, CH_BAGS).setSmallIcon(R.drawable.ic_paw)
                    .setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(open).build())
        }

        @JavascriptInterface fun copy(text: String) {
            main.post {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Puppy Log", text))
            }
        }

        @JavascriptInterface fun saveFile(name: String, mime: String, text: String, open: Boolean) {
            main.post { this@MainActivity.saveFile(name, mime, text, open) }
        }
    }
}
