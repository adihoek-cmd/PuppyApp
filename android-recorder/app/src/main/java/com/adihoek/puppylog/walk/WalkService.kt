package com.adihoek.puppylog.walk

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.util.concurrent.Executors

/**
 * Records one walk's GPS track as a foreground service.
 * - Ongoing notification with Stop (and Extend once the 2-hour warning fires).
 * - At WARN_MIN: "still walking?" alert with End now / Extend.
 * - At AUTO_STOP_MIN, unless extended: stops by itself, trimmed to when you arrived.
 * - If someone ends the walk elsewhere (PWA "End walk"), it stops and keeps their duration.
 * - On stop: writes durationMin + distanceM to the walk event, uploads the GPX to Strava.
 */
class WalkService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "com.adihoek.puppylog.walk.START"
        const val ACTION_STOP = "com.adihoek.puppylog.walk.STOP"
        const val ACTION_EXTEND = "com.adihoek.puppylog.walk.EXTEND"
        const val EXTRA_EVENT = "event"
        const val EXTRA_FAMILY = "family"
        const val EXTRA_START = "start"

        private const val CH_WALK = "walk"
        private const val CH_ALERT = "walk-alert"
        private const val CH_DONE = "walk-done"
        private const val ID_ONGOING = 1
        private const val ID_WARN = 2
        private const val ID_DONE = 3

        fun start(ctx: Context, eventId: String, family: String, startTs: Long) {
            val i = Intent(ctx, WalkService::class.java).setAction(ACTION_START)
                .putExtra(EXTRA_EVENT, eventId).putExtra(EXTRA_FAMILY, family).putExtra(EXTRA_START, startTs)
            ctx.startForegroundService(i)
        }

        fun send(ctx: Context, action: String) {
            ctx.startService(Intent(ctx, WalkService::class.java).setAction(action))
        }
    }

    private lateinit var prefs: Prefs
    private lateinit var points: PointFile
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var listening = false
    private var finishing = false
    private var lastRemoteCheck = 0L
    private var wake: PowerManager.WakeLock? = null

    private val ticker = object : Runnable {
        override fun run() {
            checkLimits()
            main.postDelayed(this, 30_000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        points = PointFile(this)
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val ev = intent.getStringExtra(EXTRA_EVENT) ?: ""
                val fam = intent.getStringExtra(EXTRA_FAMILY) ?: ""
                val ts = intent.getLongExtra(EXTRA_START, System.currentTimeMillis())
                if (ev.isEmpty() || fam.isEmpty()) { stopIfIdle(); return START_NOT_STICKY }
                if (!prefs.recording || prefs.activeEvent != ev) {
                    if (prefs.recording) {
                        // A new walk while one is running: close the old one first, as if stopped.
                        finish(auto = false, then = { begin(ev, fam, ts) })
                        goForeground()
                        return START_STICKY
                    }
                    begin(ev, fam, ts)
                } else {
                    goForeground(); listen()
                }
            }
            ACTION_STOP -> if (prefs.recording) { goForeground(); finish(auto = false) } else stopIfIdle()
            ACTION_EXTEND -> if (prefs.recording) {
                prefs.extended = true
                nm().cancel(ID_WARN)
                goForeground()
            } else stopIfIdle()
            else -> {
                // Restarted by the system after being killed: carry on with the saved walk.
                if (prefs.recording) { goForeground(); listen() } else { stopIfIdle(); return START_NOT_STICKY }
            }
        }
        return START_STICKY
    }

    private fun begin(eventId: String, family: String, startTs: Long) {
        points.clear()
        prefs.activeEvent = eventId
        prefs.activeFamily = family
        prefs.activeStart = startTs
        prefs.extended = false
        prefs.warned = false
        finishing = false
        nm().cancel(ID_DONE)
        goForeground()
        listen()
    }

    private fun goForeground() {
        val n = ongoingNotification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID_ONGOING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        else startForeground(ID_ONGOING, n)
    }

    private fun listen() {
        if (listening) return
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
        val lm = getSystemService(LocationManager::class.java)
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000L, 0f, this, Looper.getMainLooper())
            listening = true
        } catch (e: Exception) { /* no GPS provider — the walk still gets its duration */ }
        if (wake == null) {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "puppylog:walk").apply { acquire(4 * 3600_000L) }
        }
        main.removeCallbacks(ticker)
        main.post(ticker)
    }

    private fun unlisten() {
        if (listening) getSystemService(LocationManager::class.java).removeUpdates(this)
        listening = false
        main.removeCallbacks(ticker)
        wake?.let { if (it.isHeld) it.release() }
        wake = null
    }

    override fun onLocationChanged(loc: Location) {
        if (!prefs.recording || finishing) return
        if (loc.time < prefs.activeStart - 60_000) return
        points.append(Pt(loc.time, loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy else 99f,
            if (loc.hasAltitude()) loc.altitude else null))
        checkLimits()
    }

    // Older Android versions call these; nothing to do.
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun elapsedMin(): Long = (System.currentTimeMillis() - prefs.activeStart) / 60_000

    private fun checkLimits() {
        if (!prefs.recording || finishing) return
        val m = elapsedMin()
        if (!prefs.extended) {
            if (m >= Config.AUTO_STOP_MIN) { finish(auto = true); return }
            if (m >= Config.WARN_MIN && !prefs.warned) { prefs.warned = true; warn() }
        }
        val now = System.currentTimeMillis()
        if (now - lastRemoteCheck > 60_000) {
            lastRemoteCheck = now
            val fam = prefs.activeFamily; val ev = prefs.activeEvent
            io.execute {
                runCatching { Firestore(this).liveDistance(fam, ev, Track.distanceM(points.read())) }
                val d = try { Firestore(this).externalDuration(fam, ev) } catch (e: Exception) { null }
                if (d != null) main.post {
                    if (prefs.recording && prefs.activeEvent == ev && !finishing) {
                        if (d < 0) abandon() else finish(auto = false, keepDuration = true)
                    }
                }
            }
        }
        if (m % 5 == 0L) nm().notify(ID_ONGOING, ongoingNotification())
    }

    /** The walk was deleted from the log — stop quietly, upload nothing. */
    private fun abandon() {
        unlisten()
        prefs.clearActive()
        points.clear()
        nm().cancel(ID_WARN)
        stopForegroundCompat()
        stopSelf()
    }

    /**
     * Ends the walk. auto = the 150-minute stop (trim to arrival). keepDuration = someone
     * already set durationMin elsewhere, so only add the distance.
     */
    private fun finish(auto: Boolean, keepDuration: Boolean = false, then: (() -> Unit)? = null) {
        if (finishing) return
        finishing = true
        unlisten()
        nm().cancel(ID_WARN)
        val ev = prefs.activeEvent
        val fam = prefs.activeFamily
        val start = prefs.activeStart
        val now = System.currentTimeMillis()
        val all = points.read()
        prefs.clearActive()
        points.clear()

        io.execute {
            val end = if (auto) (Track.arrivalTime(all) ?: now) else now
            val track = Track.trimTo(all, end)
            val minutes = Track.durationMin(start, end)
            val meters = Track.distanceM(track)

            var saved = false
            for (attempt in 0 until 3) {
                try {
                    Firestore(this).finishWalk(fam, ev, if (keepDuration) null else minutes, meters)
                    saved = true; break
                } catch (e: Exception) { Thread.sleep(3000L * (attempt + 1)) }
            }

            // Route for Puppy Log's minimap + heatmap (only when there's a real route).
            if (Track.good(track).size >= 10 && meters >= 50) {
                val mp = Track.mapPoints(track)
                val pts = Track.encodePolyline(mp)
                val tt = Track.timeOffsets(mp, start)
                for (attempt in 0 until 3) {
                    try { Firestore(this).saveRoute(fam, ev, pts, tt, start, minutes, meters, prefs.who); break }
                    catch (e: Exception) { Thread.sleep(2000L * (attempt + 1)) }
                }
            }

            var strava = ""
            val good = Track.good(track)
            if (prefs.conn.isNotEmpty() && prefs.autoUpload && good.size >= 10 && meters >= 50) {
                val name = "🐾 Puppy walk"
                val gpx = Track.gpx(track, name)
                val extId = "puppylog-$ev"
                val r = try { Strava.upload(prefs.conn, gpx, name, extId) } catch (e: Exception) { null }
                strava = when {
                    r != null && r.ok -> " · on Strava"
                    r != null && r.code == 401 -> { prefs.conn = ""; prefs.athlete = ""; " · Strava disconnected" }
                    else -> { PendingUploads(this).add(gpx, name, extId); " · Strava upload queued" }
                }
            }

            val km = if (meters >= 1000) "%.2f km".format(meters / 1000.0) else "$meters m"
            val head = when { auto -> "Walk stopped automatically"; keepDuration -> "Walk ended in Puppy Log"; else -> "Walk saved" }
            val body = (if (keepDuration) km else "$minutes min · $km") + strava + (if (saved) "" else " · couldn't save to Puppy Log")
            main.post {
                done(head, body)
                finishing = false
                if (then != null) then() else { stopForegroundCompat(); stopSelf() }
            }
        }
    }

    private fun stopIfIdle() {
        if (!prefs.recording) { stopForegroundCompat(); stopSelf() }
    }

    private fun stopForegroundCompat() {
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        unlisten()
        io.shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- notifications

    private fun nm() = getSystemService(NotificationManager::class.java)

    private fun createChannels() {
        nm().createNotificationChannel(NotificationChannel(CH_WALK, "Walk in progress", NotificationManager.IMPORTANCE_LOW))
        nm().createNotificationChannel(NotificationChannel(CH_ALERT, "Long walk alerts", NotificationManager.IMPORTANCE_HIGH))
        nm().createNotificationChannel(NotificationChannel(CH_DONE, "Walk saved", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun pi(action: String, code: Int): PendingIntent =
        PendingIntent.getService(this, code, Intent(this, WalkService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun openApp(): PendingIntent =
        PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun builder(channel: String): Notification.Builder = Notification.Builder(this, channel)

    private fun ongoingNotification(): Notification {
        val limit = if (prefs.extended) "no time limit" else "stops by itself after ${Config.AUTO_STOP_MIN} min"
        val b = builder(CH_WALK)
            .setSmallIcon(R.drawable.ic_paw)
            .setContentTitle("🐾 Walk in progress")
            .setContentText("Recording route · $limit")
            .setUsesChronometer(true)
            .setWhen(prefs.activeStart.takeIf { it > 0 } ?: System.currentTimeMillis())
            .setOngoing(true)
            .setContentIntent(openApp())
            .addAction(Notification.Action.Builder(null, "End walk", pi(ACTION_STOP, 1)).build())
        if (!prefs.extended && prefs.warned) b.addAction(Notification.Action.Builder(null, "Extend", pi(ACTION_EXTEND, 2)).build())
        return b.build()
    }

    private fun warn() {
        val n = builder(CH_ALERT)
            .setSmallIcon(R.drawable.ic_paw)
            .setContentTitle("Still walking?")
            .setContentText("The walk has been running for 2 hours. It stops by itself at ${Config.AUTO_STOP_MIN} min unless you extend it.")
            .setStyle(Notification.BigTextStyle().bigText("The walk has been running for 2 hours. It stops by itself at ${Config.AUTO_STOP_MIN} min unless you extend it."))
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .addAction(Notification.Action.Builder(null, "End now", pi(ACTION_STOP, 3)).build())
            .addAction(Notification.Action.Builder(null, "Extend", pi(ACTION_EXTEND, 4)).build())
            .build()
        nm().notify(ID_WARN, n)
        nm().notify(ID_ONGOING, ongoingNotification())
    }

    private fun done(title: String, text: String) {
        nm().notify(ID_DONE, builder(CH_DONE).setSmallIcon(R.drawable.ic_paw).setContentTitle(title)
            .setContentText(text).setAutoCancel(true).setContentIntent(openApp()).build())
    }
}
