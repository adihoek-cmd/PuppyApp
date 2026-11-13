package com.adihoek.puppylog.walk

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// Pure track logic — no Android imports, so it can be unit-tested on a plain JVM.

data class Pt(val t: Long, val lat: Double, val lon: Double, val acc: Float, val ele: Double? = null)

object Track {
    const val MAX_ACCURACY_M = 35f   // ignore fixes worse than this
    const val MIN_STEP_M = 8.0       // GPS jitter below this isn't counted as distance
    const val SMOOTH_N = 5           // fixes averaged per position
    const val MAP_STEP_M = 10.0      // route point spacing stored for the map
    const val REST_RADIUS_M = 40.0   // "stayed in one place" radius for auto-stop trimming

    fun dist(a: Pt, b: Pt): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLon = Math.toRadians(b.lon - a.lon)
        val h = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(h), sqrt(1 - h))
    }

    fun good(points: List<Pt>): List<Pt> = points.filter { it.acc <= MAX_ACCURACY_M }

    /** Rolling mean of up to SMOOTH_N fixes, to take the edge off GPS jitter. */
    fun smooth(points: List<Pt>): List<Pt> {
        val g = good(points)
        return g.indices.map { i ->
            val from = maxOf(0, i - SMOOTH_N + 1)
            val w = g.subList(from, i + 1)
            Pt(g[i].t, w.sumOf { it.lat } / w.size, w.sumOf { it.lon } / w.size, w.map { it.acc }.average().toFloat(), g[i].ele)
        }
    }

    /**
     * Walking distance in metres. Counts a step only once the smoothed position moves
     * further than the GPS can be trusted (at least MIN_STEP_M, or the fix accuracy),
     * so standing still doesn't add up phantom metres.
     */
    fun distanceM(points: List<Pt>): Int {
        val s = smooth(points)
        if (s.size < 2) return 0
        var total = 0.0
        var anchor = s[0]
        for (i in 1 until s.size) {
            val d = dist(anchor, s[i])
            if (d >= maxOf(MIN_STEP_M, s[i].acc.toDouble())) { total += d; anchor = s[i] }
        }
        return total.roundToInt()
    }

    /**
     * For a forgotten walk: the moment you arrived at the place you then stayed.
     * Returns the timestamp of the first fix inside the final resting circle, or null
     * if there's no stationary tail to cut (e.g. the whole track is one spot).
     */
    fun arrivalTime(points: List<Pt>): Long? {
        val g = good(points)
        if (g.size < 2) return null
        val rest = g.last()
        val lastAway = g.indexOfLast { dist(it, rest) > REST_RADIUS_M }
        if (lastAway < 0) return null              // never left the spot
        val arrived = g[lastAway + 1]
        return if (arrived.t < rest.t) arrived.t else null
    }

    fun trimTo(points: List<Pt>, endT: Long): List<Pt> = points.filter { it.t <= endT }

    // ---- compact route for Puppy Log's minimap / heatmap ----

    /** Smoothed route thinned to a point every ~MAP_STEP_M metres (plus the last point). */
    fun mapPoints(points: List<Pt>): List<Pt> {
        val sm = smooth(points)
        if (sm.size < 2) return sm
        val out = mutableListOf(sm[0])
        for (i in 1 until sm.size) if (dist(out.last(), sm[i]) >= MAP_STEP_M) out += sm[i]
        if (out.last() !== sm.last()) out += sm.last()
        return out
    }

    /** Google encoded-polyline format (precision 5) — a few KB for a long walk. */
    fun encodePolyline(points: List<Pt>): String {
        val sb = StringBuilder()
        var pLat = 0L; var pLon = 0L
        for (p in points) {
            val lat = Math.round(p.lat * 1e5); val lon = Math.round(p.lon * 1e5)
            enc(lat - pLat, sb); enc(lon - pLon, sb)
            pLat = lat; pLon = lon
        }
        return sb.toString()
    }

    private fun enc(v: Long, sb: StringBuilder) {
        var x = if (v < 0) (v shl 1).inv() else (v shl 1)
        while (x >= 0x20) { sb.append(((0x20 or (x and 0x1f).toInt()) + 63).toChar()); x = x shr 5 }
        sb.append((x.toInt() + 63).toChar())
    }

    fun durationMin(startMs: Long, endMs: Long): Int =
        maxOf(1, ((endMs - startMs) / 60000.0).roundToInt())

    // ---- storage: one fix per line, survives the process being killed ----
    fun encode(p: Pt): String = "${p.t},${p.lat},${p.lon},${p.acc}${if (p.ele != null) "," + p.ele else ""}"

    fun decode(line: String): Pt? {
        val f = line.trim().split(',')
        if (f.size < 4) return null
        return try {
            Pt(f[0].toLong(), f[1].toDouble(), f[2].toDouble(), f[3].toFloat(), f.getOrNull(4)?.toDoubleOrNull())
        } catch (e: NumberFormatException) { null }
    }

    // ---- GPX ----
    fun isoUtc(ms: Long): String {
        val f = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
        f.timeZone = java.util.TimeZone.getTimeZone("UTC")
        return f.format(java.util.Date(ms))
    }

    fun gpx(points: List<Pt>, name: String): String {
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<gpx version=\"1.1\" creator=\"Puppy Log\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n")
        sb.append("  <metadata><time>").append(isoUtc(points.firstOrNull()?.t ?: 0L)).append("</time></metadata>\n")
        sb.append("  <trk><name>").append(xml(name)).append("</name><type>walking</type><trkseg>\n")
        for (p in good(points)) {
            sb.append("    <trkpt lat=\"").append(p.lat).append("\" lon=\"").append(p.lon).append("\">")
            if (p.ele != null) sb.append("<ele>").append(p.ele).append("</ele>")
            sb.append("<time>").append(isoUtc(p.t)).append("</time></trkpt>\n")
        }
        sb.append("  </trkseg></trk>\n</gpx>\n")
        return sb.toString()
    }

    private fun xml(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
}
