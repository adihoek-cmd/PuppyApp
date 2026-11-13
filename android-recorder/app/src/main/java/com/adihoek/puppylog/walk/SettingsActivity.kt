package com.adihoek.puppylog.walk

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

/**
 * Native "Walk recording & Strava" screen, opened from Puppy Log's ⚙ Settings inside the app:
 * walk status (end / extend), Strava connection, auto-upload, background permission.
 * Walks themselves are started from the Puppy Log Walk button (MainActivity + WebBridge).
 */
class SettingsActivity : Activity() {

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var status: TextView
    private lateinit var stopBtn: Button
    private lateinit var extendBtn: Button
    private lateinit var stravaStatus: TextView
    private lateinit var connectBtn: Button
    private lateinit var autoUpload: CheckBox
    private lateinit var retryBtn: Button

    private val refresher = object : Runnable {
        override fun run() { render(); main.postDelayed(this, 5000) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        buildUi()
    }

    override fun onResume() {
        super.onResume()
        main.post(refresher)
        collectStravaPairing()
        if (prefs.conn.isNotEmpty() && PendingUploads(this).count() > 0) retryUploads(quiet = true)
    }

    override fun onPause() {
        main.removeCallbacks(refresher)
        super.onPause()
    }

    // ---------------------------------------------------------------- actions

    private fun connectStrava() {
        if (prefs.conn.isNotEmpty()) {
            val conn = prefs.conn
            prefs.conn = ""; prefs.athlete = ""
            io.execute { runCatching { Strava.disconnect(conn) } }
            render(); return
        }
        val pair = Strava.newPairId()
        prefs.pendingPair = pair
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Strava.connectUrl(pair))))
    }

    /** After the Strava approval page, pick up the connection from the Worker. */
    private fun collectStravaPairing() {
        val pair = prefs.pendingPair
        if (pair.isEmpty()) return
        io.execute {
            var got: Pair<String, String>? = null
            for (i in 0 until 6) {
                got = runCatching { Strava.pollPair(pair) }.getOrNull()
                if (got != null) break
                Thread.sleep(2000)
            }
            val result = got
            main.post {
                if (result != null) {
                    prefs.conn = result.first; prefs.athlete = result.second; prefs.pendingPair = ""
                    toast("Strava connected")
                }
                render()
            }
        }
    }

    private fun retryUploads(quiet: Boolean) {
        val conn = prefs.conn
        if (conn.isEmpty()) return
        io.execute {
            val n = runCatching { PendingUploads(this).retryAll(conn) }.getOrDefault(0)
            main.post { if (!quiet || n > 0) toast("Uploaded $n walk(s) to Strava"); render() }
        }
    }

    @SuppressLint("BatteryLife")
    private fun askBatteryExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) { toast("Already unrestricted 👍"); return }
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
    }

    // ---------------------------------------------------------------- UI

    private fun render() {
        if (prefs.recording) {
            val min = (System.currentTimeMillis() - prefs.activeStart) / 60000
            val m = Track.distanceM(PointFile(this).read())
            val km = if (m >= 1000) "%.2f km".format(m / 1000.0) else "$m m"
            val limit = if (prefs.extended) "no time limit" else "auto-stop at ${Config.AUTO_STOP_MIN} min"
            status.text = "🐾 Walking · $min min · $km\n$limit"
            stopBtn.visibility = View.VISIBLE
            extendBtn.visibility = if (prefs.extended) View.GONE else View.VISIBLE
        } else {
            status.text = "No walk running — tap Walk in Puppy Log to start one"
            stopBtn.visibility = View.GONE
            extendBtn.visibility = View.GONE
        }
        val connected = prefs.conn.isNotEmpty()
        stravaStatus.text = if (connected) "Connected" + (if (prefs.athlete.isNotEmpty()) " as ${prefs.athlete}" else "") else "Not connected"
        connectBtn.text = if (connected) "Disconnect Strava" else "Connect Strava"
        autoUpload.isEnabled = connected
        autoUpload.isChecked = prefs.autoUpload
        val pending = PendingUploads(this).count()
        retryBtn.visibility = if (connected && pending > 0) View.VISIBLE else View.GONE
        retryBtn.text = "Upload $pending waiting walk(s)"
    }

    private fun buildUi() {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(20), px(28), px(20), px(28))
            setBackgroundColor(Color.parseColor("#FFF7ED"))
        }
        fun label(t: String, size: Float = 14f, bold: Boolean = false) = TextView(this).apply {
            text = t; textSize = size; setTextColor(Color.parseColor("#44403C"))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, px(14), 0, px(4))
        }
        fun button(t: String, onClick: () -> Unit) = Button(this).apply { text = t; isAllCaps = false; setOnClickListener { onClick() } }

        col.addView(button("← Back to Puppy Log") { finish() })
        col.addView(label("🛰️ Walk recording", 24f, true))
        status = label("", 18f).also { col.addView(it) }
        stopBtn = button("End walk") { WalkService.send(this, WalkService.ACTION_STOP); main.postDelayed({ render() }, 800) }.also { col.addView(it) }
        extendBtn = button("Extend (no time limit)") { WalkService.send(this, WalkService.ACTION_EXTEND); main.postDelayed({ render() }, 500) }.also { col.addView(it) }

        col.addView(label("Strava", 18f, true))
        stravaStatus = label("").also { col.addView(it) }
        connectBtn = button("Connect Strava") { connectStrava() }.also { col.addView(it) }
        autoUpload = CheckBox(this).apply {
            text = "Upload my walks to Strava automatically"
            setOnCheckedChangeListener { _, c -> prefs.autoUpload = c }
        }.also { col.addView(it) }
        retryBtn = button("Upload waiting walks") { retryUploads(quiet = false) }.also { col.addView(it) }
        col.addView(label("Strava can't make uploads private through its API. Walks are hidden from followers' feeds; to make them fully private set your default activity visibility to \"Only You\" in Strava's Privacy Controls.", 12f))

        col.addView(label("Reliability", 18f, true))
        col.addView(button("Let it run in the background (battery)") { askBatteryExemption() })
        col.addView(label("Recommended on Samsung phones, otherwise the phone may stop the recording when the screen is off.", 12f))

        setContentView(ScrollView(this).apply { addView(col); isFillViewport = true; fitsSystemWindows = true; setBackgroundColor(Color.parseColor("#FFF7ED")) })
        col.gravity = Gravity.TOP
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }
}
