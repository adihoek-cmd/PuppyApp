// Puppy Log ↔ Strava bridge (Cloudflare Worker)
//
// Keeps the Strava client secret and every family member's Strava tokens out of
// the apps and out of Firestore. Each device holds only an opaque connection id.
//
// Flow for any device (phone app or watch):
//   1. Device makes a random pair id P and opens   /connect?pair=P   in a browser
//      (the watch opens it on the paired phone).
//   2. The person approves on Strava → /callback stores the tokens under a new
//      connection id and parks it under P for 10 minutes.
//   3. Device polls   /pair?id=P   until it receives { conn, athlete }.
//   4. Uploads:   POST /upload   with  Authorization: Bearer <conn>  and the GPX body.
//
// Bindings (see wrangler.toml):
//   STRAVA               KV namespace
//   STRAVA_CLIENT_ID     var
//   STRAVA_CLIENT_SECRET secret  (npx wrangler secret put STRAVA_CLIENT_SECRET)

const STRAVA = "https://www.strava.com";
const API = STRAVA + "/api/v3";
const PAIR_TTL = 600;            // seconds a finished pairing waits to be collected
const MAX_GPX_BYTES = 5_000_000; // a 3-hour walk at 1 point/sec is ~1.5 MB

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
      switch (url.pathname) {
        case "/":             return text("Puppy Log Strava bridge is running.");
        case "/connect":      return connect(url, env);
        case "/callback":     return callback(url, env);
        case "/pair":         return cors(await pair(url, env));
        case "/me":           return cors(await me(req, env));
        case "/upload":       return cors(await upload(req, url, env));
        case "/upload-status":return cors(await uploadStatus(req, url, env));
        case "/disconnect":   return cors(await disconnect(req, env));
        default:              return text("Not found", 404);
      }
    } catch (err) {
      return cors(json({ error: String(err && err.message || err) }, 500));
    }
  },
};

// ---------------------------------------------------------------- OAuth

function validId(s) { return typeof s === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(s); }

function connect(url, env) {
  const pairId = url.searchParams.get("pair");
  if (!validId(pairId)) return text("Missing or invalid pair id.", 400);
  const auth = new URL(STRAVA + "/oauth/mobile/authorize");
  auth.searchParams.set("client_id", env.STRAVA_CLIENT_ID);
  auth.searchParams.set("redirect_uri", url.origin + "/callback");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("approval_prompt", "auto");
  auth.searchParams.set("scope", "activity:write");
  auth.searchParams.set("state", pairId);
  return Response.redirect(auth.toString(), 302);
}

async function callback(url, env) {
  const pairId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return page("החיבור בוטל", "לא חיברנו את Strava. אפשר לחזור לאפליקציה ולנסות שוב.");
  if (!validId(pairId) || !code) return page("משהו השתבש", "חסרים פרטים בתשובה מ-Strava. נסו שוב מהאפליקציה.");
  const scope = url.searchParams.get("scope") || "";
  if (!scope.split(",").includes("activity:write")) {
    return page("חסרה הרשאה", "כדי להעלות טיולים צריך לאשר ב-Strava את ההרשאה להעלאת פעילויות. נסו שוב ואשרו אותה.");
  }

  const tok = await tokenRequest(env, { grant_type: "authorization_code", code });
  const conn = randomId();
  const athlete = tok.athlete ? { id: tok.athlete.id, name: [tok.athlete.firstname, tok.athlete.lastname].filter(Boolean).join(" ") } : null;
  await env.STRAVA.put("conn:" + conn, JSON.stringify({
    access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_at,
    athlete, created: Date.now(),
  }));
  await env.STRAVA.put("pair:" + pairId, JSON.stringify({ conn, athlete }), { expirationTtl: PAIR_TTL });
  const who = athlete && athlete.name ? " בתור " + escapeHtml(athlete.name) : "";
  return page("Strava מחובר 🐾", "התחברת" + who + ". אפשר לסגור את הדף ולחזור ל-Puppy Log.");
}

async function pair(url, env) {
  const pairId = url.searchParams.get("id");
  if (!validId(pairId)) return json({ error: "invalid id" }, 400);
  const v = await env.STRAVA.get("pair:" + pairId);
  if (!v) return json({ pending: true });
  await env.STRAVA.delete("pair:" + pairId); // hand out once
  return json(JSON.parse(v));
}

async function tokenRequest(env, params) {
  const body = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params });
  const r = await fetch(STRAVA + "/oauth/token", { method: "POST", body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Strava token error " + r.status + ": " + JSON.stringify(data));
  return data;
}

// Loads a connection and refreshes its access token when it is within an hour of expiry.
async function loadConn(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/);
  if (!m || !validId(m[1])) return null;
  const key = "conn:" + m[1];
  const raw = await env.STRAVA.get(key);
  if (!raw) return null;
  const c = JSON.parse(raw);
  if (!c.expires_at || c.expires_at - 3600 < Date.now() / 1000) {
    const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: c.refresh_token });
    c.access_token = t.access_token; c.refresh_token = t.refresh_token; c.expires_at = t.expires_at;
    await env.STRAVA.put(key, JSON.stringify(c));
  }
  return { key, c };
}

// ---------------------------------------------------------------- API

async function me(req, env) {
  const s = await loadConn(req, env);
  if (!s) return json({ connected: false }, 401);
  return json({ connected: true, athlete: s.c.athlete });
}

// POST /upload?name=...&external_id=...   body = GPX
async function upload(req, url, env) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const s = await loadConn(req, env);
  if (!s) return json({ error: "not connected" }, 401);
  const gpx = await req.arrayBuffer();
  if (!gpx.byteLength) return json({ error: "empty GPX" }, 400);
  if (gpx.byteLength > MAX_GPX_BYTES) return json({ error: "GPX too large" }, 413);

  const form = new FormData();
  const externalId = (url.searchParams.get("external_id") || "puppylog-" + Date.now()).slice(0, 120);
  form.append("file", new File([gpx], externalId + ".gpx", { type: "application/gpx+xml" }));
  form.append("data_type", "gpx");
  form.append("name", (url.searchParams.get("name") || "🐾 Puppy walk").slice(0, 120));
  form.append("description", "Logged with Puppy Log");
  form.append("external_id", externalId);

  const r = await fetch(API + "/uploads", { method: "POST", headers: { Authorization: "Bearer " + s.c.access_token }, body: form });
  const up = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "Strava upload failed", status: r.status, detail: up }, 502);

  // Strava processes uploads asynchronously; wait briefly so we can mark it a Walk.
  return json(await settleUpload(s.c.access_token, up.id_str || String(up.id), 4));
}

// GET /upload-status?id=...  — for uploads that were still processing.
async function uploadStatus(req, url, env) {
  const s = await loadConn(req, env);
  if (!s) return json({ error: "not connected" }, 401);
  const id = url.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) return json({ error: "invalid id" }, 400);
  return json(await settleUpload(s.c.access_token, id, 1));
}

async function settleUpload(token, uploadId, tries) {
  let st = null;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((res) => setTimeout(res, 2000));
    const r = await fetch(API + "/uploads/" + uploadId, { headers: { Authorization: "Bearer " + token } });
    st = await r.json().catch(() => ({}));
    if (st.error) return { uploadId, state: "error", error: st.error };
    if (st.activity_id) {
      await fetch(API + "/activities/" + st.activity_id, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        // The API can't set "Only You" visibility (Strava removed it); hide_from_home is the
        // closest it allows: the walk stays off followers' home feeds.
        body: JSON.stringify({ sport_type: "Walk", hide_from_home: true }),
      });
      return { uploadId, state: "done", activityId: st.activity_id, url: STRAVA + "/activities/" + st.activity_id };
    }
  }
  return { uploadId, state: "processing" };
}

async function disconnect(req, env) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const s = await loadConn(req, env);
  if (!s) return json({ ok: true });
  await fetch(STRAVA + "/oauth/deauthorize", { method: "POST", body: new URLSearchParams({ access_token: s.c.access_token }) }).catch(() => {});
  await env.STRAVA.delete(s.key);
  return json({ ok: true });
}

// ---------------------------------------------------------------- helpers

function randomId() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function text(s, status = 200) { return new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
function cors(res) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
function page(title, body) {
  return new Response(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff7ed;font-family:system-ui,sans-serif;color:#44403c;padding:24px}
.c{max-width:360px;background:#fff;border-radius:24px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,.08);text-align:center}h1{font-size:20px;margin:8px 0}p{font-size:15px;line-height:1.5;color:#57534e}</style></head>
<body><div class="c"><div style="font-size:40px">🐶</div><h1>${escapeHtml(title)}</h1><p>${body}</p></div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
