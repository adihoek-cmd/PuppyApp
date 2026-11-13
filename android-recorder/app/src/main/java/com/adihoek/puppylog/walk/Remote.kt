package com.adihoek.puppylog.walk

import android.content.Context
import org.json.JSONObject

/**
 * Minimal Firestore REST client for the two things the recorder needs:
 * creating a walk event and setting durationMin / distanceM on it.
 * Uses the same anonymous auth and event fields as the PWA and the watch.
 */
class Firestore(ctx: Context) {
    private val prefs = Prefs(ctx)

    private fun token(): String {
        val now = System.currentTimeMillis()
        if (prefs.idToken.isNotEmpty() && prefs.idTokenExp - 120_000 > now) return prefs.idToken
        if (prefs.refreshToken.isNotEmpty()) {
            val r = Net.request(
                "POST", "https://securetoken.googleapis.com/v1/token?key=${Config.API_KEY}",
                "grant_type=refresh_token&refresh_token=${Net.enc(prefs.refreshToken)}".toByteArray(),
                mapOf("Content-Type" to "application/x-www-form-urlencoded"),
            )
            if (r.ok) {
                val j = JSONObject(r.body)
                prefs.idToken = j.getString("id_token")
                prefs.refreshToken = j.getString("refresh_token")
                prefs.idTokenExp = now + j.getString("expires_in").toLong() * 1000
                return prefs.idToken
            }
        }
        val r = Net.request(
            "POST", "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${Config.API_KEY}",
            JSONObject().put("returnSecureToken", true).toString().toByteArray(),
            mapOf("Content-Type" to "application/json"),
        )
        if (!r.ok) throw RuntimeException("Firebase sign-in failed (${r.code}): ${r.body.take(200)}")
        val j = JSONObject(r.body)
        prefs.idToken = j.getString("idToken")
        prefs.refreshToken = j.getString("refreshToken")
        prefs.idTokenExp = now + j.getString("expiresIn").toLong() * 1000
        return prefs.idToken
    }

    private fun eventsUrl(family: String) =
        "https://firestore.googleapis.com/v1/projects/${Config.PROJECT}/databases/(default)/documents/families/${Net.enc(family)}/events"

    private fun auth() = mapOf("Authorization" to "Bearer ${token()}", "Content-Type" to "application/json")

    /** Same shape the PWA writes when you tap Walk: { type, ts, by }. Returns the new event id. */
    fun createWalk(family: String, by: String, ts: Long): String {
        val fields = JSONObject()
            .put("type", JSONObject().put("stringValue", "walk"))
            .put("ts", JSONObject().put("integerValue", ts.toString()))
            .put("by", JSONObject().put("stringValue", by.ifBlank { "Someone" }))
        val r = Net.request("POST", eventsUrl(family), JSONObject().put("fields", fields).toString().toByteArray(), auth())
        if (!r.ok) throw RuntimeException("Couldn't log the walk (${r.code}): ${r.body.take(200)}")
        return JSONObject(r.body).getString("name").substringAfterLast('/')
    }

    /** Sets durationMin (unless null) and distanceM on an existing walk. Never creates a document. */
    fun finishWalk(family: String, eventId: String, durationMin: Int?, distanceM: Int) {
        val fields = JSONObject()
        val mask = StringBuilder()
        if (durationMin != null) {
            fields.put("durationMin", JSONObject().put("integerValue", durationMin.toString()))
            mask.append("updateMask.fieldPaths=durationMin&")
        }
        if (distanceM > 0) {
            fields.put("distanceM", JSONObject().put("integerValue", distanceM.toString()))
            mask.append("updateMask.fieldPaths=distanceM&")
        }
        if (mask.isEmpty()) return
        val url = eventsUrl(family) + "/" + Net.enc(eventId) + "?" + mask + "currentDocument.exists=true"
        val r = Net.request("PATCH", url, JSONObject().put("fields", fields).toString().toByteArray(), auth())
        if (!r.ok) throw RuntimeException("Couldn't save the walk (${r.code}): ${r.body.take(200)}")
    }

    /** durationMin someone else set on this walk (e.g. "End walk" in the PWA), or null. Missing event → -1. */
    fun externalDuration(family: String, eventId: String): Int? {
        val r = Net.request("GET", eventsUrl(family) + "/" + Net.enc(eventId), null, auth())
        if (r.code == 404) return -1
        if (!r.ok) return null
        val f = JSONObject(r.body).optJSONObject("fields") ?: return null
        val d = f.optJSONObject("durationMin") ?: return null
        return (d.optString("integerValue").ifEmpty { d.optString("doubleValue") }).toDoubleOrNull()?.toInt()
    }
}

/** Client for the puppy-strava Worker. */
object Strava {
    fun connectUrl(pairId: String) = "${Config.WORKER}/connect?pair=${Net.enc(pairId)}"

    /** Returns (conn, athleteName) once the person has approved on Strava, else null. */
    fun pollPair(pairId: String): Pair<String, String>? {
        val r = Net.request("GET", "${Config.WORKER}/pair?id=${Net.enc(pairId)}")
        if (!r.ok) return null
        val j = JSONObject(r.body)
        val conn = j.optString("conn")
        if (conn.isEmpty()) return null
        val name = j.optJSONObject("athlete")?.optString("name") ?: ""
        return conn to name
    }

    fun upload(conn: String, gpx: String, name: String, externalId: String): HttpResult =
        Net.request(
            "POST", "${Config.WORKER}/upload?name=${Net.enc(name)}&external_id=${Net.enc(externalId)}",
            gpx.toByteArray(), mapOf("Authorization" to "Bearer $conn", "Content-Type" to "application/gpx+xml"),
        )

    fun disconnect(conn: String) {
        Net.request("POST", "${Config.WORKER}/disconnect", ByteArray(0), mapOf("Authorization" to "Bearer $conn"))
    }

    fun newPairId(): String {
        val b = ByteArray(18); java.security.SecureRandom().nextBytes(b)
        return android.util.Base64.encodeToString(b, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
    }
}
