package com.adihoek.puppylog.walk

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.io.File

/** Settings + the state of the walk being recorded (survives the process being killed). */
class Prefs(ctx: Context) {
    private val p: SharedPreferences = ctx.getSharedPreferences("walk", Context.MODE_PRIVATE)

    var family: String get() = p.getString("family", "") ?: ""; set(v) = p.edit().putString("family", v).apply()
    var who: String get() = p.getString("who", "") ?: ""; set(v) = p.edit().putString("who", v).apply()

    // Strava (connection id from the puppy-strava Worker; the tokens never leave the Worker)
    var conn: String get() = p.getString("conn", "") ?: ""; set(v) = p.edit().putString("conn", v).apply()
    var athlete: String get() = p.getString("athlete", "") ?: ""; set(v) = p.edit().putString("athlete", v).apply()
    var autoUpload: Boolean get() = p.getBoolean("autoUpload", true); set(v) = p.edit().putBoolean("autoUpload", v).apply()
    var pendingPair: String get() = p.getString("pendingPair", "") ?: ""; set(v) = p.edit().putString("pendingPair", v).apply()

    // Firebase anonymous auth
    var idToken: String get() = p.getString("idToken", "") ?: ""; set(v) = p.edit().putString("idToken", v).apply()
    var idTokenExp: Long get() = p.getLong("idTokenExp", 0); set(v) = p.edit().putLong("idTokenExp", v).apply()
    var refreshToken: String get() = p.getString("refreshToken", "") ?: ""; set(v) = p.edit().putString("refreshToken", v).apply()

    // Active walk
    var activeEvent: String get() = p.getString("activeEvent", "") ?: ""; set(v) = p.edit().putString("activeEvent", v).commit().let { }
    var activeFamily: String get() = p.getString("activeFamily", "") ?: ""; set(v) = p.edit().putString("activeFamily", v).commit().let { }
    var activeStart: Long get() = p.getLong("activeStart", 0); set(v) = p.edit().putLong("activeStart", v).commit().let { }
    var extended: Boolean get() = p.getBoolean("extended", false); set(v) = p.edit().putBoolean("extended", v).commit().let { }
    var warned: Boolean get() = p.getBoolean("warned", false); set(v) = p.edit().putBoolean("warned", v).commit().let { }

    val recording get() = activeEvent.isNotEmpty()

    fun clearActive() {
        p.edit().remove("activeEvent").remove("activeFamily").remove("activeStart")
            .remove("extended").remove("warned").commit()
    }
}

/** GPS fixes of the active walk, appended line by line. */
class PointFile(ctx: Context) {
    val file = File(ctx.filesDir, "active-track.csv")
    fun clear() { file.delete() }
    fun append(p: Pt) { file.appendText(Track.encode(p) + "\n") }
    fun read(): List<Pt> = if (file.exists()) file.readLines().mapNotNull { Track.decode(it) } else emptyList()
}

/** Strava uploads that failed (no network etc.), retried later. */
class PendingUploads(ctx: Context) {
    private val dir = File(ctx.filesDir, "pending").apply { mkdirs() }

    fun add(gpx: String, name: String, externalId: String) {
        File(dir, "$externalId.gpx").writeText(gpx)
        File(dir, "$externalId.json").writeText(JSONObject().put("name", name).put("externalId", externalId).toString())
    }

    fun count(): Int = dir.listFiles { f -> f.name.endsWith(".gpx") }?.size ?: 0

    /** Tries every queued upload once; returns how many went through. */
    fun retryAll(conn: String): Int {
        var done = 0
        dir.listFiles { f -> f.name.endsWith(".json") }?.forEach { meta ->
            val j = JSONObject(meta.readText())
            val gpxFile = File(dir, j.getString("externalId") + ".gpx")
            if (!gpxFile.exists()) { meta.delete(); return@forEach }
            val r = Strava.upload(conn, gpxFile.readText(), j.getString("name"), j.getString("externalId"))
            // "duplicate" means Strava already has it — count it as done.
            if (r.ok || r.body.contains("duplicate", ignoreCase = true)) {
                gpxFile.delete(); meta.delete(); done++
            }
        }
        return done
    }
}
