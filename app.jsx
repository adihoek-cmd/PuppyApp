/*
 * Puppy Log — readable source.
 * Build to app.js with:
 *   npx esbuild app.jsx --minify --format=iife --target=es2017 --outfile=app.js
 *
 * React, ReactDOM and firebase (compat) are loaded as globals from CDNs in
 * index.html, so this file has no imports. Firebase config lives in index.html
 * (window.PUPPY_CONFIG) and is never touched by rebuilding app.js.
 */
const { useState, useEffect, useRef } = React;

// Bump APP_VERSION on every release. Shown in ⚙ Settings so you can confirm
// at a glance which build a phone is actually running (catches stale caches).
const APP_VERSION = "1.4";
const APP_BUILD = "04 Aug 2026";

const cfg = window.PUPPY_CONFIG || {};
const NEEDS_SETUP = !cfg.firebase || /PASTE|YOUR_/.test(JSON.stringify(cfg.firebase || {}));

let db = null, auth = null, FieldDelete = null;
if (!NEEDS_SETUP) {
  firebase.initializeApp(cfg.firebase);
  auth = firebase.auth();
  db = firebase.firestore();
  FieldDelete = firebase.firestore.FieldValue.delete();
}

// ---- built-in event types (Meds is a custom one-off instead) ----
const TYPES = {
  pee:      { glyph: "💧", label: "No.1", full: "Wee",      main: true,  btn: "bg-yellow-400 text-yellow-950 active:bg-yellow-500",   tint: "bg-yellow-50 text-yellow-800", hex: "#facc15" },
  poop:     { glyph: "💩", label: "No.2", full: "Poo",      main: true,  btn: "bg-amber-700 text-amber-50 active:bg-amber-800",       tint: "bg-amber-50 text-amber-800",   hex: "#b45309" },
  walk:     { glyph: "🐾", label: "Walk", full: "Walk",     main: true,  btn: "bg-emerald-500 text-emerald-50 active:bg-emerald-600", tint: "bg-emerald-50 text-emerald-800", hex: "#10b981" },
  training: { glyph: "🦴", label: "Train", full: "Training", main: false, btn: "bg-violet-500 text-violet-50 active:bg-violet-600",    tint: "bg-violet-50 text-violet-700", hex: "#8b5cf6" },
  sleep:    { glyph: "😴", label: "Sleep", full: "Sleep",    main: false, btn: "bg-indigo-500 text-indigo-50 active:bg-indigo-600",    tint: "bg-indigo-50 text-indigo-700", hex: "#6366f1" },
};

// colour choices for custom events (literal classes so Tailwind CDN picks them up)
const SWATCHES = {
  sky:    { btn: "bg-sky-500 text-sky-50 active:bg-sky-600",          tint: "bg-sky-50 text-sky-700",       hex: "#0ea5e9" },
  rose:   { btn: "bg-rose-500 text-rose-50 active:bg-rose-600",       tint: "bg-rose-50 text-rose-700",     hex: "#f43f5e" },
  indigo: { btn: "bg-indigo-500 text-indigo-50 active:bg-indigo-600", tint: "bg-indigo-50 text-indigo-700", hex: "#6366f1" },
  teal:   { btn: "bg-teal-500 text-teal-50 active:bg-teal-600",       tint: "bg-teal-50 text-teal-700",     hex: "#14b8a6" },
  orange: { btn: "bg-orange-500 text-orange-50 active:bg-orange-600", tint: "bg-orange-50 text-orange-700", hex: "#f97316" },
  pink:   { btn: "bg-pink-500 text-pink-50 active:bg-pink-600",       tint: "bg-pink-50 text-pink-700",     hex: "#ec4899" },
};
const SWATCH_KEYS = Object.keys(SWATCHES);
const EMOJI_SUGGEST = ["💊", "🍖", "🛁", "🏥", "💉", "🦷", "🧼", "🦮", "🐕", "🍗", "😴", "🪮"];

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + "-" + Math.random().toString(36).slice(2);

function resolveType(typeId, customTypes) {
  if (TYPES[typeId]) return TYPES[typeId];
  const c = (customTypes || []).find((x) => x.id === typeId);
  if (c) return { glyph: c.glyph, full: c.name, label: c.name, ...(SWATCHES[c.color] || SWATCHES.sky) };
  return { glyph: "•", full: "Other", label: "Other", ...SWATCHES.sky };
}
// One-off events (type "once") carry their own name/emoji/colour on the event.
function eventDisplay(e, customTypes) {
  if (e.type === "once") {
    return { glyph: e.glyph || "⭐", full: e.label || "Event", label: e.label || "Event", ...(SWATCHES[e.color] || SWATCHES.sky) };
  }
  return resolveType(e.type, customTypes);
}

// ---- time helpers ----
function ago(ts, now) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? h + "h " + rm + "m ago" : h + "h ago";
  const d = Math.floor(h / 24); return d === 1 ? "1 day ago" : d + " days ago";
}
const clockTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
function dayLabel(ts, now) {
  if (dayKey(ts) === dayKey(now)) return "Today";
  if (dayKey(ts) === dayKey(now - 86400000)) return "Yesterday";
  return new Date(ts).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
function toLocalInput(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
}
const fromLocalInput = (s) => new Date(s).getTime();

// walk distance (metres) like "820 m" / "1.24 km" — written by the watch companion
function fmtDist(m) {
  const v = Math.max(0, Math.round(Number(m) || 0));
  return v < 1000 ? v + " m" : (v / 1000).toFixed(2) + " km";
}

// duration like "1h 23m" / "45m" / "0m"
function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "0m";
  const h = Math.floor(m / 60), rm = m % 60;
  return h ? (rm ? h + "h " + rm + "m" : h + "h") : rm + "m";
}
// split a [start,end] interval into per-calendar-day pieces: [{key, ms}]
function splitByDay(start, end) {
  const out = []; let s = start;
  while (s < end) {
    const d = new Date(s);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const seg = Math.min(end, nextMidnight);
    out.push({ key: dayKey(s), ms: seg - s });
    s = seg;
  }
  return out;
}
// accumulate a [start,end] interval into per-hour-of-day buckets (ms)
function splitByHour(start, end, arr) {
  let s = start;
  while (s < end) {
    const d = new Date(s);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const seg = Math.min(end, nextHour);
    arr[d.getHours()] += seg - s;
    s = seg;
  }
}
// A sleep left running longer than this is almost certainly a forgotten timer.
const STUCK_HOURS = 12;
const STUCK_MS = STUCK_HOURS * 3600000;

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const GAP_BUCKETS = [
  { label: "<1h", min: 0, max: 1 },
  { label: "1–2h", min: 1, max: 2 },
  { label: "2–3h", min: 2, max: 3 },
  { label: "3–4h", min: 3, max: 4 },
  { label: "4h+", min: 4, max: Infinity },
];
// gaps (ms) between consecutive "breaks" of a type in the last 7 days, split into
// day (06:00–21:00) and night (21:00–06:00) by the midpoint of each gap.
// Two events closer than MERGE_MS count as the same break (e.g. two wees minutes
// apart is one trip), so those tiny gaps don't drag the typical interval down.
const MERGE_MS = 30 * 60000;
function splitGaps(events, type, now) {
  const start7 = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.getTime(); })();
  const raw = events.filter((e) => e.type === type && e.ts >= start7).map((e) => e.ts).sort((a, b) => a - b);
  // collapse clusters: keep only the first event of each ≤30-min run
  const ts = [];
  raw.forEach((t) => { if (!ts.length || t - ts[ts.length - 1] > MERGE_MS) ts.push(t); });
  const day = [], night = [];
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    const hr = new Date(ts[i - 1] + gap / 2).getHours();
    (hr >= 6 && hr < 21 ? day : night).push(gap);
  }
  return { day, night, all: day.concat(night) };
}

// ---- trend detection ----
function fmtHour(h) {
  h = ((h % 24) + 24) % 24;
  const hh = h % 12 || 12;
  return hh + " " + (h < 12 ? "AM" : "PM");
}
function fmtHourRange(a, b) {
  const a12 = a % 12 || 12, b12 = b % 24 % 12 || 12;
  const ap = a < 12 ? "AM" : "PM", bp = b % 24 < 12 ? "AM" : "PM";
  return ap === bp ? `${a12}–${b12} ${bp}` : `${a12} ${ap}–${b12} ${bp}`;
}
// for each 2-hour window [h,h+2), how many distinct days + total events fall in it
function hourWindows(evs) {
  const w = Array.from({ length: 24 }, () => ({ days: new Set(), count: 0 }));
  evs.forEach((e) => {
    const hr = new Date(e.ts).getHours(), dk = dayKey(e.ts);
    [hr - 1, hr].forEach((h) => { if (h >= 0 && h < 24) { w[h].days.add(dk); w[h].count++; } });
  });
  return w;
}
// greedily pick up to 2 non-overlapping windows that pass the ok() test, strongest first
function pickWindows(w, ok) {
  const used = new Set(), out = [];
  while (out.length < 2) {
    let best = -1, bestScore = -1;
    for (let h = 0; h < 23; h++) {
      if (used.has(h) || used.has(h + 1)) continue;
      if (ok(w[h]) && w[h].days.size > bestScore) { bestScore = w[h].days.size; best = h; }
    }
    if (best < 0) break;
    out.push({ h: best, days: w[best].days.size });
    used.add(best); used.add(best + 1);
  }
  return out;
}
const fmtClockMin = (min) => { min = ((min % 1440) + 1440) % 1440; const h = Math.floor(min / 60), m = min % 60; return (h % 12 || 12) + ":" + String(m).padStart(2, "0") + " " + (h < 12 ? "AM" : "PM"); };
// median clock-minute of events whose hour falls in window [h,h+2)
function windowMedianMinute(evs, h) {
  const mins = evs.filter((e) => { const hr = new Date(e.ts).getHours(); return hr === h || hr === h + 1; }).map((e) => { const d = new Date(e.ts); return d.getHours() * 60 + d.getMinutes(); });
  return mins.length ? Math.round(median(mins)) : h * 60 + 30;
}
const escapeICS = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
const icsStampUTC = (d) => { const p = (n) => String(n).padStart(2, "0"); return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z"; };
// a daily-recurring calendar event at hour:minute (device-local), alarm at start
function makeReminderICS({ title, note, hour, minute }) {
  const p = (n) => String(n).padStart(2, "0"), s = new Date();
  const dt = s.getFullYear() + p(s.getMonth() + 1) + p(s.getDate()) + "T" + p(hour) + p(minute) + "00";
  const id = "puppylog-" + Math.random().toString(36).slice(2) + "@puppylog";
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PuppyLog//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", "UID:" + id, "DTSTAMP:" + icsStampUTC(new Date()), "DTSTART:" + dt, "DURATION:PT10M", "RRULE:FREQ=DAILY", "SUMMARY:" + escapeICS(title), "DESCRIPTION:" + escapeICS(note || "From Puppy Log"), "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + escapeICS(title), "TRIGGER:PT0M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
function downloadICS(filename, text) {
  try {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) { console.error(e); }
}
// download an object as a pretty-printed JSON file (used for data backup)
function downloadJSON(filename, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) { console.error(e); }
}

// ============================ ROOT ============================
function App() {
  if (NEEDS_SETUP) return <SetupScreen />;

  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [family, setFamily] = useState(() => localStorage.getItem("puppy-family") || "");

  useEffect(() => {
    auth.signInAnonymously().catch((e) => setAuthError(e.message));
    return auth.onAuthStateChanged((u) => setAuthed(!!u));
  }, []);

  if (authError) return <Splash text={"Couldn't connect: " + authError} />;
  if (!authed) return <Splash text="Connecting…" />;
  if (!family) return <FamilyGate onJoin={(c) => { localStorage.setItem("puppy-family", c); setFamily(c); }} />;

  return <Tracker family={family} onLeave={() => { localStorage.removeItem("puppy-family"); setFamily(""); }} />;
}

function Splash({ text }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-orange-50 px-6 text-center text-amber-700">
      <div><div className="text-4xl mb-2 animate-pulse">🐶</div><div className="text-sm font-medium">{text}</div></div>
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-emerald-50 px-6">
      <div className="max-w-sm rounded-3xl bg-white p-6 shadow-lg">
        <div className="text-4xl mb-3">🐶</div>
        <h1 className="text-xl font-extrabold text-stone-800">Almost there</h1>
        <p className="mt-2 text-sm text-stone-600">Paste your Firebase config into the top of <code className="rounded bg-stone-100 px-1">index.html</code>, then reload. The README has the full step-by-step.</p>
      </div>
    </div>
  );
}

function FamilyGate({ onJoin }) {
  const [code, setCode] = useState("");
  const norm = code.trim().toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-amber-50 to-emerald-50 px-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-lg">
        <div className="text-4xl mb-3">🐶</div>
        <h1 className="text-xl font-extrabold text-stone-800">Your family code</h1>
        <p className="mt-2 text-sm text-stone-600">Pick a secret code and have everyone in the family enter the <b>same one</b> — it's your shared, private log.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && norm && onJoin(norm)}
          placeholder="e.g. rex-house-2026" autoFocus
          className="mt-4 w-full rounded-xl border border-stone-200 bg-white px-3 py-3 text-base outline-none focus:border-amber-400" />
        <button onClick={() => norm && onJoin(norm)} disabled={!norm}
          className="mt-3 w-full rounded-xl bg-amber-600 py-3 text-sm font-bold text-white active:bg-amber-700 disabled:opacity-40">
          Start logging
        </button>
        <p className="mt-3 text-xs text-stone-400">Saved on this device so you won't retype it.</p>
      </div>
    </div>
  );
}

// ============================ TRACKER ============================
function Tracker({ family, onLeave }) {
  const [events, setEvents] = useState([]);
  const [config, setConfig] = useState({ puppyName: "our puppy", customTypes: [] });
  const [who, setWho] = useState(() => localStorage.getItem("puppy-who") || "");
  const [tab, setTab] = useState("log");
  const [now, setNow] = useState(Date.now());
  const [editTarget, setEditTarget] = useState(null);
  const [editingPuppy, setEditingPuppy] = useState(false);
  const [editingWho, setEditingWho] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [oneOff, setOneOff] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const famRef = db.collection("families").doc(family);

  useEffect(() => {
    const unsubEv = famRef.collection("events").orderBy("ts", "desc").onSnapshot((snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubCfg = famRef.collection("meta").doc("config").onSnapshot((d) => {
      const data = d.exists ? d.data() : {};
      setConfig({ puppyName: data.puppyName || "our puppy", customTypes: data.customTypes || [] });
    });
    return () => { unsubEv(); unsubCfg(); };
  }, [family]);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(id); }, []);

  const { puppyName, customTypes } = config;
  const rt = (typeId) => resolveType(typeId, customTypes);

  // ---- ongoing sleep + auto-wake ----
  const ongoingSleep = events.find((e) => e.type === "sleep" && e.ongoing && !e.end);
  const ongoingMs = ongoingSleep ? now - ongoingSleep.ts : 0;
  const sleepStuck = !!ongoingSleep && ongoingMs > STUCK_MS;
  // Any new action means he's awake: close an active (non-stuck) sleep at that time.
  const endSleepIfActive = (ts) => {
    if (ongoingSleep && !sleepStuck && ts > ongoingSleep.ts) {
      famRef.collection("events").doc(ongoingSleep.id).update({ end: ts, ongoing: FieldDelete });
    }
  };

  // ---- writes ----
  const addEvent = (type) => {
    const data = { type, ts: Date.now(), by: who || "Someone" };
    famRef.collection("events").add(data);
    endSleepIfActive(data.ts);
  };
  const saveEvent = ({ id, type, ts, end, durationMin, distanceM, place }) => {
    if (type === "sleep") {
      if (id) {
        const data = { type, ts };
        if (end) { data.end = end; data.ongoing = FieldDelete; } else { data.ongoing = true; data.end = FieldDelete; }
        famRef.collection("events").doc(id).update(data);
      } else {
        const data = { type, ts, by: who || "Someone" };
        if (end) data.end = end; else data.ongoing = true;
        famRef.collection("events").add(data);
      }
      return;
    }
    const isPotty = type === "pee" || type === "poop";
    const accident = isPotty && place && place !== "outside";
    if (id) {
      const data = { type, ts };
      data.durationMin = type === "walk" && durationMin ? durationMin : FieldDelete;
      data.distanceM = type === "walk" && distanceM ? distanceM : FieldDelete;
      data.indoor = accident ? true : FieldDelete;
      data.place = accident && place === "cave" ? "cave" : FieldDelete;
      famRef.collection("events").doc(id).update(data);
    } else {
      const data = { type, ts, by: who || "Someone" };
      if (type === "walk" && durationMin) data.durationMin = durationMin;
      if (type === "walk" && distanceM) data.distanceM = distanceM;
      if (accident) { data.indoor = true; if (place === "cave") data.place = "cave"; }
      famRef.collection("events").add(data);
      endSleepIfActive(ts);
    }
  };
  const saveOneOff = ({ id, ts, label, glyph, color }) => {
    if (id) {
      famRef.collection("events").doc(id).update({ ts, label, glyph, color: color || "sky" });
    } else {
      famRef.collection("events").add({ type: "once", ts, by: who || "Someone", label, glyph, color: color || "sky" });
      endSleepIfActive(ts);
    }
  };
  const removeEvent = (id) => famRef.collection("events").doc(id).delete();

  const startSleep = () => { if (!ongoingSleep) famRef.collection("events").add({ type: "sleep", ts: Date.now(), by: who || "Someone", ongoing: true }); };
  const stopSleep = () => { if (ongoingSleep) famRef.collection("events").doc(ongoingSleep.id).update({ end: Date.now(), ongoing: FieldDelete }); };

  // The most recent walk that still has no length set — "open" and endable.
  // Capped at 3h so an old, never-timed walk doesn't offer a silly duration.
  const WALK_OPEN_MAX_MS = 3 * 3600000;
  const openWalk = events.find((e) => e.type === "walk" && !e.durationMin && e.ts <= now && now - e.ts < WALK_OPEN_MAX_MS);
  const endWalk = () => {
    if (!openWalk) return;
    const mins = Math.max(1, Math.round((Date.now() - openWalk.ts) / 60000));
    famRef.collection("events").doc(openWalk.id).update({ durationMin: mins });
  };

  const setPuppyName = (n) => famRef.collection("meta").doc("config").set({ puppyName: n }, { merge: true });
  const removeCustomType = (id) => famRef.collection("meta").doc("config").set({ customTypes: config.customTypes.filter((c) => c.id !== id) }, { merge: true });

  const savePuppyName = () => { const n = draftName.trim() || "our puppy"; setPuppyName(n); setEditingPuppy(false); };
  const saveWho = (name) => { const n = name.trim(); if (!n) return; setWho(n); setEditingWho(false); localStorage.setItem("puppy-who", n); };

  // Full local backup of everything currently synced for this family.
  const exportData = () => downloadJSON(
    "puppy-log-backup-" + new Date().toISOString().slice(0, 10) + ".json",
    { app: "Puppy Log", exportedAt: new Date().toISOString(), family, puppyName, customTypes, events }
  );

  // ---- derived ----
  const lastOf = (type) => events.find((e) => e.type === type);

  const todayK = dayKey(now);
  const sleepMsByDay = {};
  events.forEach((e) => {
    if (e.type !== "sleep") return;
    const ongoing = e.ongoing && !e.end;
    if (ongoing && now - e.ts > STUCK_MS) return; // forgotten timer — don't count until fixed
    const end = e.end || (ongoing ? now : null);
    if (end && end > e.ts) splitByDay(e.ts, end).forEach((s) => { sleepMsByDay[s.key] = (sleepMsByDay[s.key] || 0) + s.ms; });
  });
  const todaySleepMs = sleepMsByDay[todayK] || 0;

  const grouped = [];
  let cur = null;
  events.forEach((e) => {
    const lbl = dayLabel(e.ts, now);
    if (!cur || cur.label !== lbl) { cur = { label: lbl, key: dayKey(e.ts), items: [] }; grouped.push(cur); }
    cur.items.push(e);
  });

  // Nest activities that happened during a walk. Walks with a length use that
  // span; walks without one get a 10-minute grace window from their start.
  // Indoor accidents never nest — by definition they didn't happen on the walk.
  const WALK_GRACE_MS = 10 * 60000;
  const walks = events.filter((e) => e.type === "walk");
  const walkEnd = (w) => w.ts + (w.durationMin ? w.durationMin * 60000 : WALK_GRACE_MS);
  const childOf = {}; // eventId -> walk id
  events.forEach((e) => {
    if (e.type === "walk" || e.type === "sleep" || e.indoor) return;
    let best = null;
    walks.forEach((w) => {
      if (e.id === w.id) return;
      if (e.ts >= w.ts && e.ts <= walkEnd(w) && (!best || w.ts > best.ts)) best = w;
    });
    if (best) childOf[e.id] = best.id;
  });
  const childrenOf = {}; // walk id -> [child events, chronological]
  events.forEach((e) => { if (childOf[e.id]) (childrenOf[childOf[e.id]] = childrenOf[childOf[e.id]] || []).push(e); });
  Object.values(childrenOf).forEach((arr) => arr.sort((a, b) => a.ts - b.ts));
  const placeBadge = (e) => e.indoor ? (e.place === "cave"
    ? <span className="ml-1.5 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700">🛖 dog cave</span>
    : <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">🏠 indoors</span>) : null;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    const de = events.filter((e) => dayKey(e.ts) === k);
    days.push({
      label: d.toLocaleDateString([], { weekday: "short" }),
      pee: de.filter((e) => e.type === "pee").length,
      poop: de.filter((e) => e.type === "poop").length,
      walk: de.filter((e) => e.type === "walk").length,
      training: de.filter((e) => e.type === "training").length,
      walkMin: de.filter((e) => e.type === "walk").reduce((s, e) => s + (e.durationMin || 0), 0),
      indoor: de.filter((e) => e.indoor).length,
    });
  }
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  const stats = { pee: (sum("pee") / 7).toFixed(1), poop: (sum("poop") / 7).toFixed(1), walk: sum("walk"), walkMin: sum("walkMin"), training: sum("training"), indoor: sum("indoor") };

  const byHour = Array.from({ length: 24 }, () => ({ pee: 0, poop: 0, indoor: 0 }));
  events.forEach((e) => {
    if (e.type === "pee" || e.type === "poop") {
      const h = new Date(e.ts).getHours();
      if (e.indoor) byHour[h].indoor++; else byHour[h][e.type]++;
    }
  });

  const weeG = splitGaps(events, "pee", now);
  const pooG = splitGaps(events, "poop", now);
  const inBucket = (g, b) => { const h = g / 3600000; return h >= b.min && h < b.max; };
  const med = (a) => (a.length ? median(a) : null);
  const intervals = {
    wee: { day: med(weeG.day), night: med(weeG.night) },
    poo: { day: med(pooG.day), night: med(pooG.night) },
    buckets: GAP_BUCKETS.map((b) => ({ label: b.label, wee: weeG.all.filter((g) => inBucket(g, b)).length, poo: pooG.all.filter((g) => inBucket(g, b)).length })),
  };

  const secondary = ["training", ...customTypes.map((c) => c.id)];

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50 to-emerald-50 text-stone-800">
      <div className="mx-auto max-w-md px-4 py-5" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>

        {/* Header */}
        <header className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-amber-700">
              <span className="text-xs">🐾</span>
              <span className="text-xs font-semibold uppercase tracking-wider">Puppy log</span>
            </div>
            {editingPuppy ? (
              <div className="flex items-center gap-1.5 mt-1">
                <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && savePuppyName()}
                  placeholder="Puppy's name" className="w-40 rounded-lg border border-amber-300 bg-white px-2 py-1 text-lg font-bold outline-none focus:border-amber-500" />
                <button onClick={savePuppyName} className="rounded-lg bg-amber-600 px-2 py-1 text-sm font-bold text-white active:bg-amber-700">OK</button>
              </div>
            ) : (
              <button onClick={() => { setDraftName(puppyName === "our puppy" ? "" : puppyName); setEditingPuppy(true); }} className="group flex items-center gap-1.5 mt-0.5">
                <h1 className="text-2xl font-extrabold leading-tight truncate">{puppyName}</h1>
                <span className="text-xs text-stone-400 group-active:text-stone-600">✏️</span>
              </button>
            )}
          </div>
          <button onClick={() => setShowSettings(true)} className="shrink-0 rounded-full bg-white/70 px-3 py-2 text-stone-500 shadow-sm active:bg-white" aria-label="Settings">⚙️</button>
        </header>

        {/* Who */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-stone-400">👤</span>
          {who && !editingWho ? (
            <span className="text-stone-600">Logging as <button onClick={() => setEditingWho(true)} className="font-semibold text-amber-700 underline decoration-dotted underline-offset-2">{who}</button></span>
          ) : (<WhoPicker onPick={saveWho} initial={who} />)}
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>Live</span>
        </div>

        {/* Tabs */}
        <div className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-white/60 p-1 shadow-sm">
          {[["log", "📋 Log"], ["charts", "📊 Charts"], ["sleep", "😴 Sleep"], ["trends", "💡 Trends"]].map(([id, lbl]) => (
            <button key={id} onClick={() => setTab(id)} className={"rounded-xl px-1 py-2 text-xs font-semibold transition-colors " + (tab === id ? "bg-white text-amber-700 shadow-sm" : "text-stone-500")}>{lbl}</button>
          ))}
        </div>

        {tab === "log" ? (
          <>
            {/* Sleep control */}
            {ongoingSleep ? (
              <div className={"mb-4 flex items-center gap-3 rounded-2xl p-3.5 text-white shadow-md " + (sleepStuck ? "bg-amber-600" : "bg-indigo-600")}>
                <span className="text-2xl animate-pulse">{sleepStuck ? "⚠️" : "😴"}</span>
                <div className="min-w-0 flex-1">
                  {sleepStuck ? (
                    <>
                      <div className="text-sm font-bold">Still asleep after {fmtDur(ongoingMs)}?</div>
                      <div className="truncate text-xs text-amber-100">Looks like a forgotten timer — fix the end time, or stop.</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-bold">Asleep · {fmtDur(ongoingMs)}</div>
                      <div className="truncate text-xs text-indigo-200">since {clockTime(ongoingSleep.ts)} · started by {ongoingSleep.by}</div>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => setEditTarget(ongoingSleep)} className="rounded-xl bg-white/20 px-3 py-2 text-sm font-bold active:bg-white/30">Fix</button>
                  <button onClick={stopSleep} className="rounded-xl bg-white/20 px-3 py-2 text-sm font-bold active:bg-white/30">Stop</button>
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <button onClick={startSleep} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 py-3.5 text-white shadow-md transition-transform active:scale-95 active:bg-indigo-600">
                  <span className="text-xl">😴</span><span className="font-bold">Start sleep</span>
                </button>
                {todaySleepMs > 0 ? <div className="mt-1 text-center text-xs text-stone-400">Slept {fmtDur(todaySleepMs)} today</div> : null}
              </div>
            )}

            {/* Status strip */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {["pee", "poop", "walk"].map((t) => {
                const last = lastOf(t);
                return (
                  <div key={t} className={"rounded-2xl p-3 " + TYPES[t].tint}>
                    <div className="text-xl leading-none">{TYPES[t].glyph}</div>
                    <div className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-70">Last {TYPES[t].full.toLowerCase()}</div>
                    <div className="text-sm font-bold leading-tight">{last ? ago(last.ts, now) : "—"}</div>
                  </div>
                );
              })}
            </div>

            {/* Main pads */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              {["pee", "poop", "walk"].map((t) => (
                <button key={t} onClick={() => addEvent(t)} className={"flex flex-col items-center justify-center rounded-3xl py-6 shadow-md transition-transform active:scale-95 " + TYPES[t].btn}>
                  <span className="text-4xl">{TYPES[t].glyph}</span>
                  <span className="mt-1.5 text-sm font-extrabold">{TYPES[t].label}</span>
                  <span className="text-[11px] font-medium opacity-80">{TYPES[t].full}</span>
                </button>
              ))}
            </div>

            {/* End the last untimed walk */}
            {openWalk ? (
              <button onClick={endWalk} className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-700 shadow-sm transition-transform active:scale-95 active:bg-emerald-100">
                <span>⏱️</span>End previous walk · {fmtDur(now - openWalk.ts)}
              </button>
            ) : null}

            {/* Secondary + custom pads */}
            <div className="mb-5 flex flex-wrap gap-2">
              {secondary.map((t) => {
                const T = rt(t);
                return (
                  <button key={t} onClick={() => addEvent(t)} className={"flex flex-1 min-w-[30%] items-center justify-center gap-2 rounded-2xl py-3 shadow-sm transition-transform active:scale-95 " + T.btn}>
                    <span className="text-lg">{T.glyph}</span><span className="text-sm font-bold">{T.full}</span>
                  </button>
                );
              })}
              <button onClick={() => setOneOff({ isNew: true, ts: Date.now() })} className="flex flex-1 min-w-[30%] items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-stone-300 py-3 text-sm font-semibold text-stone-400 active:bg-white/60">＋ One-off</button>
            </div>

            {/* History */}
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">History</h2>
                <button onClick={() => setEditTarget({ isNew: true, type: "pee", ts: Date.now() })} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 shadow-sm active:bg-amber-50">＋ Add entry</button>
              </div>
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-4 py-8 text-center text-sm text-stone-500">No entries yet. Tap a button when {puppyName} goes — everyone in the family sees it here.</div>
              ) : (
                <div className="space-y-4">
                  {grouped.map((g) => (
                    <div key={g.label}>
                      <div className="mb-1.5 px-1 text-xs font-bold text-stone-500">{g.label}</div>
                      <DaySummary items={g.items} sleepMs={sleepMsByDay[g.key] || 0} isToday={g.key === todayK} customTypes={customTypes} />
                      <ul className="overflow-hidden rounded-2xl bg-white/80 shadow-sm divide-y divide-stone-100">
                        {g.items.map((e) => {
                          if (childOf[e.id]) return null; // shown nested under its walk
                          const T = eventDisplay(e, customTypes);
                          const kids = e.type === "walk" ? childrenOf[e.id] : null;
                          return (
                            <li key={e.id}>
                              <button onClick={() => e.type === "once" ? setOneOff(e) : setEditTarget(e)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-stone-50">
                                <span className="text-lg">{T.glyph}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-semibold text-stone-700">
                                    {T.full}
                                    {e.type === "walk" && e.durationMin ? <span className="ml-1.5 text-xs font-medium text-emerald-600">· {e.durationMin} min</span> : null}
                                    {e.type === "walk" && e.distanceM ? <span className="ml-1.5 text-xs font-medium text-emerald-600">· {fmtDist(e.distanceM)}</span> : null}
                                    {e.type === "sleep" ? (e.end ? <span className="ml-1.5 text-xs font-medium text-indigo-600">· {fmtDur(e.end - e.ts)}</span> : <span className="ml-1.5 text-xs font-medium text-indigo-500">· sleeping…</span>) : null}
                                    {placeBadge(e)}
                                    <span className="ml-2 text-xs font-normal text-stone-400">{e.by}</span>
                                  </div>
                                </div>
                                <span className="shrink-0 text-sm font-medium tabular-nums text-stone-500">{clockTime(e.ts)}</span>
                                <span className="shrink-0 text-xs text-stone-300">✏️</span>
                              </button>
                              {kids && kids.length ? (
                                <div className="ml-6 border-l-2 border-emerald-200 pb-1">
                                  {kids.map((c) => {
                                    const CT = eventDisplay(c, customTypes);
                                    return (
                                      <button key={c.id} onClick={() => c.type === "once" ? setOneOff(c) : setEditTarget(c)} className="flex w-full items-center gap-2 py-1.5 pl-3 pr-3 text-left active:bg-stone-50">
                                        <span className="text-base">{CT.glyph}</span>
                                        <div className="min-w-0 flex-1">
                                          <span className="text-sm font-medium text-stone-600">{CT.full}</span>
                                          {placeBadge(c)}
                                        </div>
                                        <span className="shrink-0 text-xs font-medium tabular-nums text-stone-400">{clockTime(c.ts)}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : tab === "charts" ? (
          <ChartsView days={days} stats={stats} byHour={byHour} intervals={intervals} hasData={events.length > 0} />
        ) : tab === "sleep" ? (
          <SleepView events={events} now={now} />
        ) : (
          <TrendsView events={events} now={now} puppyName={puppyName} />
        )}

        <footer className="mt-6 pb-6 text-center text-[11px] text-stone-400">Family code: <b>{family}</b> · synced live</footer>
      </div>

      {editTarget && (
        <EditSheet target={editTarget} customTypes={customTypes}
          onClose={() => setEditTarget(null)}
          onSave={(data) => { saveEvent(data); setEditTarget(null); }}
          onDelete={editTarget.isNew ? null : () => { removeEvent(editTarget.id); setEditTarget(null); }} />
      )}
      {oneOff && (
        <OneOffSheet target={oneOff}
          onClose={() => setOneOff(null)}
          onSave={(data) => { saveOneOff(data); setOneOff(null); }}
          onDelete={oneOff.isNew ? null : () => { removeEvent(oneOff.id); setOneOff(null); }} />
      )}
      {showSettings && (
        <SettingsSheet family={family} customTypes={customTypes} onRemoveCustom={removeCustomType} onExport={exportData} onLeave={onLeave} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// ============================ CHARTS ============================
function ChartsView({ days, stats, byHour, intervals, hasData }) {
  if (!hasData) {
    return <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-4 py-10 text-center text-sm text-stone-500">Charts appear once you've logged a few entries.</div>;
  }
  const cards = [
    { txt: stats.pee + "/day", glyph: "💧" }, { txt: stats.poop + "/day", glyph: "💩" },
    { txt: stats.walk + " walks", glyph: "🐾" }, { txt: stats.walkMin + " min", glyph: "⏱️" },
    { txt: stats.training + " train", glyph: "🦴" }, { txt: stats.indoor + " indoors", glyph: "🏠" },
  ];
  const maxDay = Math.max(1, ...days.map((d) => d.pee + d.poop + d.walk));
  const maxHour = Math.max(1, ...byHour.map((h) => h.pee + h.poop + h.indoor));
  const DH = 130, HH = 84;
  const seg = (n, max, H) => Math.round((n / max) * H);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-stone-400">Last 7 days</h2>
        <div className="grid grid-cols-3 gap-2">
          {cards.map((s, i) => (
            <div key={i} className="rounded-2xl bg-white/80 p-3 text-center shadow-sm">
              <div className="text-lg leading-none">{s.glyph}</div>
              <div className="mt-1 text-sm font-bold tabular-nums text-stone-700">{s.txt}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-stone-700">Daily activity</h3>
        <div className="flex items-end gap-1.5" style={{ height: DH }}>
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col-reverse overflow-hidden rounded-md" style={{ minHeight: 2 }}>
              {d.pee ? <div className="bg-yellow-400" style={{ height: seg(d.pee, maxDay, DH) }} /> : null}
              {d.poop ? <div className="bg-amber-700" style={{ height: seg(d.poop, maxDay, DH) }} /> : null}
              {d.walk ? <div className="bg-emerald-500" style={{ height: seg(d.walk, maxDay, DH) }} /> : null}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {days.map((d, i) => <div key={i} className="flex-1 text-center text-[10px] text-stone-400">{d.label}</div>)}
        </div>
        <Legend items={[["💧 Wee", "#facc15"], ["💩 Poo", "#b45309"], ["🐾 Walk", "#10b981"]]} />
      </div>

      <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
        <h3 className="text-sm font-bold text-stone-700">Potty by hour</h3>
        <p className="mb-3 text-xs text-stone-400">When he usually goes — red marks indoor accidents, so you can spot the risky hours.</p>
        <div className="flex items-end gap-px" style={{ height: HH }}>
          {byHour.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm" style={{ minHeight: 1 }}>
              {h.pee ? <div className="bg-yellow-400" style={{ height: seg(h.pee, maxHour, HH) }} /> : null}
              {h.poop ? <div className="bg-amber-700" style={{ height: seg(h.poop, maxHour, HH) }} /> : null}
              {h.indoor ? <div className="bg-red-500" style={{ height: seg(h.indoor, maxHour, HH) }} /> : null}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-px">
          {byHour.map((_, i) => <div key={i} className="flex-1 text-center text-[8px] text-stone-300">{i % 6 === 0 ? i : ""}</div>)}
        </div>
        <Legend items={[["💧 Wee", "#facc15"], ["💩 Poo", "#b45309"], ["🏠 Indoors", "#ef4444"]]} />
      </div>

      <IntervalsChart intervals={intervals} />
    </div>
  );
}

function IntervalsChart({ intervals }) {
  const { wee, poo, buckets } = intervals;
  const maxCount = Math.max(1, ...buckets.flatMap((b) => [b.wee, b.poo]));
  const H = 96;
  const barH = (n) => (n ? Math.max(3, Math.round((n / maxCount) * H)) : 0);
  const cell = (v) => (v ? "~" + fmtDur(v) : "—");
  return (
    <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
      <h3 className="text-sm font-bold text-stone-700">Time between breaks</h3>
      <p className="mb-3 text-xs text-stone-400">How long he typically holds it — day vs night.</p>

      <div className="mb-4 overflow-hidden rounded-xl border border-stone-100">
        <div className="grid grid-cols-3 bg-stone-50 text-[11px] font-semibold text-stone-500">
          <div className="px-3 py-2" />
          <div className="px-2 py-2 text-center">☀️ Day 6–21</div>
          <div className="px-2 py-2 text-center">🌙 Night 21–6</div>
        </div>
        <div className="grid grid-cols-3 border-t border-stone-100 text-sm">
          <div className="px-3 py-2.5 font-semibold text-yellow-800">💧 Wee</div>
          <div className="px-2 py-2.5 text-center font-bold tabular-nums text-stone-700">{cell(wee.day)}</div>
          <div className="px-2 py-2.5 text-center font-bold tabular-nums text-stone-700">{cell(wee.night)}</div>
        </div>
        <div className="grid grid-cols-3 border-t border-stone-100 text-sm">
          <div className="px-3 py-2.5 font-semibold text-amber-800">💩 Poo</div>
          <div className="px-2 py-2.5 text-center font-bold tabular-nums text-stone-700">{cell(poo.day)}</div>
          <div className="px-2 py-2.5 text-center font-bold tabular-nums text-stone-700">{cell(poo.night)}</div>
        </div>
      </div>

      <p className="mb-1.5 text-xs font-medium text-stone-500">All gaps by length</p>
      <div className="flex items-end gap-2" style={{ height: H }}>
        {buckets.map((b, i) => (
          <div key={i} className="flex flex-1 items-end justify-center gap-0.5">
            <div className="w-3 rounded-t bg-yellow-400" style={{ height: barH(b.wee) }} />
            <div className="w-3 rounded-t bg-amber-700" style={{ height: barH(b.poo) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {buckets.map((b, i) => <div key={i} className="flex-1 text-center text-[10px] text-stone-400">{b.label}</div>)}
      </div>
      <Legend items={[["💧 Wee gaps", "#facc15"], ["💩 Poo gaps", "#b45309"]]} />
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {items.map(([lbl, c]) => (
        <span key={lbl} className="flex items-center gap-1 text-[11px] text-stone-500"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{lbl}</span>
      ))}
    </div>
  );
}

// ============================ SLEEP ============================
function SleepView({ events, now }) {
  const stuck = events.some((e) => e.type === "sleep" && e.ongoing && !e.end && now - e.ts > STUCK_MS);
  const notice = stuck ? (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-700">
      ⚠️ A sleep has been running over {STUCK_HOURS}h — it's left out of these numbers until you stop or fix it on the Log tab.
    </div>
  ) : null;

  const sleeps = events
    .filter((e) => e.type === "sleep")
    .map((e) => { const ongoing = e.ongoing && !e.end; return { start: e.ts, end: e.end || (ongoing ? now : null), ongoing }; })
    .filter((s) => s.end && s.end > s.start && !(s.ongoing && s.end - s.start > STUCK_MS));

  if (sleeps.length === 0) {
    return (
      <div className="space-y-4">
        {notice}
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-4 py-10 text-center text-sm text-stone-500">
          No sleep logged yet. Tap <b className="text-indigo-600">😴 Start sleep</b> on the Log tab when he dozes off, and again when he wakes.
        </div>
      </div>
    );
  }

  const dayMs = {};
  sleeps.forEach((s) => splitByDay(s.start, s.end).forEach((seg) => { dayMs[seg.key] = (dayMs[seg.key] || 0) + seg.ms; }));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString([], { weekday: "short" }), hrs: (dayMs[dayKey(d.getTime())] || 0) / 3600000 });
  }

  const hourMs = Array.from({ length: 24 }, () => 0);
  sleeps.forEach((s) => splitByHour(s.start, s.end, hourMs));

  const start7 = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.getTime(); })();
  const last7Ms = days.reduce((a, d) => a + d.hrs * 3600000, 0);
  const naps7 = sleeps.filter((s) => s.start >= start7).length;
  const longest = Math.max(0, ...sleeps.map((s) => s.end - s.start));
  const todayMs = dayMs[dayKey(now)] || 0;

  const cards = [
    { glyph: "💤", txt: fmtDur(last7Ms / 7) + "/day" },
    { glyph: "🌙", txt: fmtDur(todayMs) + " today" },
    { glyph: "🏆", txt: fmtDur(longest) + " longest" },
    { glyph: "🔁", txt: (naps7 / 7).toFixed(1) + " naps/day" },
  ];

  const maxHrs = Math.max(1, ...days.map((d) => d.hrs));
  const maxHour = Math.max(1, ...hourMs);
  const DH = 130, HH = 84;

  return (
    <div className="space-y-5">
      {notice}
      <div>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-stone-400">Sleep — last 7 days</h2>
        <div className="grid grid-cols-2 gap-2">
          {cards.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-2xl bg-white/80 p-3 shadow-sm">
              <span className="text-lg leading-none">{s.glyph}</span>
              <span className="text-sm font-bold tabular-nums text-stone-700">{s.txt}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-stone-700">Hours slept per day</h3>
        <div className="flex items-end gap-1.5" style={{ height: DH }}>
          {days.map((d, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end">
              <div className="mb-0.5 text-[10px] font-semibold tabular-nums text-indigo-600">{d.hrs ? d.hrs.toFixed(1) : ""}</div>
              <div className="w-full rounded-t-md bg-indigo-500" style={{ height: Math.round((d.hrs / maxHrs) * (DH - 16)) }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {days.map((d, i) => <div key={i} className="flex-1 text-center text-[10px] text-stone-400">{d.label}</div>)}
        </div>
      </div>

      <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
        <h3 className="text-sm font-bold text-stone-700">Typical sleep schedule</h3>
        <p className="mb-3 text-xs text-stone-400">Which hours of the day he's usually asleep.</p>
        <div className="flex items-end gap-px" style={{ height: HH }}>
          {hourMs.map((ms, i) => (
            <div key={i} className="flex-1 overflow-hidden rounded-sm bg-indigo-500" style={{ height: Math.max(ms ? 2 : 0, Math.round((ms / maxHour) * HH)) }} />
          ))}
        </div>
        <div className="mt-1 flex gap-px">
          {hourMs.map((_, i) => <div key={i} className="flex-1 text-center text-[8px] text-stone-300">{i % 6 === 0 ? i : ""}</div>)}
        </div>
      </div>
    </div>
  );
}

// ============================ TRENDS ============================
function InsightCard({ icon, title, detail, tone, remind }) {
  const toneCls = tone === "good" ? "border-emerald-100 bg-emerald-50" : tone === "warn" ? "border-amber-100 bg-amber-50" : "border-stone-100 bg-white/80";
  return (
    <div className={"flex items-start gap-3 rounded-2xl border p-3.5 shadow-sm " + toneCls}>
      <span className="text-xl leading-none">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-stone-800">{title}</div>
        <div className="text-xs text-stone-500">{detail}</div>
        {remind ? (
          <button onClick={() => downloadICS(remind.file, makeReminderICS(remind))} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 shadow-sm active:bg-amber-50">
            ⏰ Remind me daily · {fmtClockMin(remind.hour * 60 + remind.minute)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TrendsView({ events, now, puppyName }) {
  const name = puppyName || "your pup";
  const LB = 14;
  const start = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (LB - 1)); return d.getTime(); })();
  const inLB = events.filter((e) => e.ts >= start);
  const activeDays = new Set(inLB.map((e) => dayKey(e.ts))).size;

  if (activeDays < 3) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-4 py-10 text-center text-sm text-stone-500">
        Keep logging for a few days — patterns like his poo schedule and accident-prone times will show up here.
      </div>
    );
  }

  const insights = [];
  const actionable = []; // predictions used for the "Coming up" panel

  // recurring routine times
  const routine = (type, icon, verb, remindable) => {
    const evs = inLB.filter((e) => e.type === type);
    pickWindows(hourWindows(evs), (win) => win.days.size >= 3 && win.days.size / activeDays >= 0.5).forEach((p) => {
      const medMin = windowMedianMinute(evs, p.h);
      const ins = { icon, tone: "neutral", title: `${verb} around ${fmtHourRange(p.h, p.h + 2)}`, detail: `typically ~${fmtClockMin(medMin)} · on ${p.days} of the last ${activeDays} days` };
      if (remindable) {
        const rm = (((medMin - 15) % 1440) + 1440) % 1440;
        ins.remind = { file: "poo-reminder.ics", title: `🐶 ${name}: poo likely ~${fmtClockMin(medMin)} — head out`, note: "Heads-up from Puppy Log trends", hour: Math.floor(rm / 60), minute: rm % 60 };
        actionable.push({ glyph: icon, label: "poo likely", predMin: medMin });
      }
      insights.push(ins);
    });
  };
  routine("poop", "💩", "Usually poos", true);
  routine("pee", "💧", "Reliable wee time", false);
  routine("walk", "🐾", "Walks usually", false);

  // where accidents cluster
  const accEvs = inLB.filter((e) => e.indoor);
  const accDays = new Set(accEvs.map((e) => dayKey(e.ts))).size;
  if (accEvs.length) {
    pickWindows(hourWindows(accEvs), (win) => win.days.size >= 2 && win.days.size / Math.max(1, accDays) >= 0.5).forEach((p) => {
      const medMin = windowMedianMinute(accEvs, p.h);
      const rm = (((medMin - 15) % 1440) + 1440) % 1440;
      insights.push({ icon: "🏠", tone: "warn", title: `Accidents cluster around ${fmtHourRange(p.h, p.h + 2)}`, detail: `~${fmtClockMin(medMin)} · ${p.days} of ${accDays} accident days — get outside first`, remind: { file: "accident-reminder.ics", title: `🐶 ${name}: accident-prone time — take him out`, note: "Heads-up from Puppy Log trends", hour: Math.floor(rm / 60), minute: rm % 60 } });
      actionable.push({ glyph: "🏠", label: "watch for accidents", predMin: medMin });
    });
  }

  // accident trend, this week vs the week before
  const cntBetween = (a, b) => events.filter((e) => e.indoor && e.ts >= a && e.ts < b).length;
  const wk1 = cntBetween(now - 7 * 86400000, now + 1), wk2 = cntBetween(now - 14 * 86400000, now - 7 * 86400000);
  if (wk1 + wk2 > 0) {
    if (wk1 < wk2) insights.push({ icon: "📉", tone: "good", title: "Accidents improving", detail: `${wk1} this week vs ${wk2} the week before` });
    else if (wk1 > wk2) insights.push({ icon: "📈", tone: "warn", title: "More accidents this week", detail: `${wk1} this week vs ${wk2} the week before` });
    else insights.push({ icon: "➖", tone: "neutral", title: "Accidents holding steady", detail: `${wk1} this week, same as the week before` });
  }

  // accident-free streak / clean sheet
  const lastAcc = events.filter((e) => e.indoor).sort((a, b) => b.ts - a.ts)[0];
  if (lastAcc) {
    const daysSince = Math.floor((now - lastAcc.ts) / 86400000);
    if (daysSince >= 2) insights.push({ icon: "🎉", tone: "good", title: `${daysSince} days accident-free`, detail: `Last one was ${new Date(lastAcc.ts).toLocaleDateString([], { month: "short", day: "numeric" })}` });
  } else {
    insights.push({ icon: "⭐", tone: "good", title: "No indoor accidents logged", detail: "Nice — keep it up" });
  }

  // "Coming up" — soonest predicted events
  const todayMid = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const upcoming = actionable.map((a) => { let at = todayMid + a.predMin * 60000; if (at < now) at += 86400000; return { ...a, at, isToday: at < todayMid + 86400000 }; }).sort((x, y) => x.at - y.at).slice(0, 2);

  if (!insights.length && !upcoming.length) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-4 py-10 text-center text-sm text-stone-500">
        No strong patterns yet. As his routine settles, recurring times will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {upcoming.length ? (
        <div className="rounded-2xl bg-amber-500 p-4 text-white shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-100">Coming up</div>
          {upcoming.map((u, i) => (
            <div key={i} className="mt-1.5 flex items-center gap-2">
              <span className="text-lg">{u.glyph}</span>
              <span className="text-sm font-bold">{u.label} · ~{fmtClockMin(u.predMin)}</span>
              <span className="ml-auto shrink-0 text-xs font-medium text-amber-100">{u.isToday ? "in " + fmtDur(u.at - now) : "tomorrow"}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="px-1 text-xs text-stone-400">Spotted from the last {LB} days · updates as you log.</p>
      {insights.map((it, i) => <InsightCard key={i} {...it} />)}
      <p className="px-1 pt-1 text-[11px] leading-relaxed text-stone-400">⏰ Reminders add a repeating event with a 15-min-early alert to your phone's calendar — that's what actually pings you, since a web app can't send notifications on its own. Re-tap if his schedule shifts.</p>
    </div>
  );
}

// A day's wrap-up. In the reverse-chronological list this sits at the top of the
// day's block, which is midnight — the day's chronological end.
function DaySummary({ items, sleepMs, isToday, customTypes }) {
  const count = (t) => items.filter((e) => e.type === t).length;
  const walkMin = items.filter((e) => e.type === "walk").reduce((s, e) => s + (e.durationMin || 0), 0);
  const cave = items.filter((e) => e.indoor && e.place === "cave").length;
  const house = items.filter((e) => e.indoor).length - cave;
  const onceCount = items.filter((e) => e.type === "once").length;

  const chips = [
    { glyph: "💧", txt: count("pee"), always: true },
    { glyph: "💩", txt: count("poop"), always: true },
    { glyph: "🐾", txt: count("walk") + (walkMin ? " · " + walkMin + "m" : ""), always: true },
    { glyph: "🦴", txt: count("training") },
    ...customTypes.map((c) => ({ glyph: c.glyph, txt: count(c.id) })),
    { glyph: "⭐", txt: onceCount },
    { glyph: "😴", txt: sleepMs ? fmtDur(sleepMs) : 0 },
  ].filter((c) => c.always || c.txt);

  return (
    <div className="mb-1.5 rounded-2xl border border-stone-200/80 bg-white/70 px-3 py-2.5 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{isToday ? "So far today" : "Day summary"}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-stone-600">
        {chips.map((c, i) => (
          <span key={i} className="flex items-center gap-1"><span>{c.glyph}</span><span className="tabular-nums">{c.txt}</span></span>
        ))}
        {house > 0 ? <span className="flex items-center gap-1 text-red-600"><span>🏠</span><span className="tabular-nums">{house}</span></span> : null}
        {cave > 0 ? <span className="flex items-center gap-1 text-orange-600"><span>🛖</span><span className="tabular-nums">{cave}</span></span> : null}
        {house + cave === 0 ? <span className="text-xs font-medium text-emerald-600">✓ no accidents</span> : null}
      </div>
    </div>
  );
}

// ============================ SHEETS ============================
function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl" style={{ paddingBottom: "max(1.75rem, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-stone-800">{title}</h3>
          <button onClick={onClose} className="rounded-full px-2 py-1 text-stone-400 active:bg-stone-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditSheet({ target, customTypes, onSave, onDelete, onClose }) {
  const [type, setType] = useState(target.type || "pee");
  const [when, setWhen] = useState(toLocalInput(target.ts || Date.now()));
  const [endWhen, setEndWhen] = useState(target.end ? toLocalInput(target.end) : "");
  const [dur, setDur] = useState(target.durationMin || "");
  const [dist, setDist] = useState(target.distanceM || "");
  const [place, setPlace] = useState(target.indoor ? (target.place === "cave" ? "cave" : "house") : "outside");
  const isNew = !!target.isNew;
  const all = ["pee", "poop", "walk", "training", "sleep", ...customTypes.map((c) => c.id)];
  const isPotty = type === "pee" || type === "poop";
  const isSleep = type === "sleep";
  const save = () => {
    if (isSleep) {
      onSave({ id: isNew ? undefined : target.id, type, ts: fromLocalInput(when), end: endWhen ? fromLocalInput(endWhen) : undefined });
    } else {
      onSave({ id: isNew ? undefined : target.id, type, ts: fromLocalInput(when), durationMin: dur ? Number(dur) : undefined, distanceM: dist ? Number(dist) : undefined, place: isPotty ? place : undefined });
    }
  };

  return (
    <Sheet title={isNew ? "Add entry" : "Edit entry"} onClose={onClose}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">What</label>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {all.map((t) => {
          const T = resolveType(t, customTypes);
          return (
            <button key={t} onClick={() => setType(t)} className={"flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors " + (type === t ? T.btn : "bg-stone-100 text-stone-500")}>
              <span className="text-base">{T.glyph}</span>{T.full}
            </button>
          );
        })}
      </div>

      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">{isSleep ? "Started" : "When"}</label>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-4 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />

      {isSleep && (
        <>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">Ended</label>
          <input type="datetime-local" value={endWhen} onChange={(e) => setEndWhen(e.target.value)} className="mb-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400" />
          <p className="mb-4 text-xs text-stone-400">Leave empty if he's still sleeping.</p>
        </>
      )}

      {isPotty && (
        <>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">Where did it happen?</label>
          <div className="mb-4 grid grid-cols-3 gap-1.5">
            {[["outside", "Outside", "🌳"], ["house", "Indoors", "🏠"], ["cave", "Dog cave", "🛖"]].map(([val, lbl, em]) => {
              const on = place === val;
              const onCls = val === "outside" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : val === "cave" ? "border-orange-200 bg-orange-50 text-orange-700" : "border-red-200 bg-red-50 text-red-600";
              return (
                <button key={val} onClick={() => setPlace(val)} className={"flex flex-col items-center gap-0.5 rounded-xl border py-2 text-xs font-semibold transition-colors " + (on ? onCls : "border-stone-200 bg-white text-stone-400")}>
                  <span className="text-lg">{em}</span>{lbl}
                </button>
              );
            })}
          </div>
        </>
      )}

      {type === "walk" && (
        <>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">Walk length</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[5, 10, 15, 20, 30, 45, 60].map((m) => (
              <button key={m} onClick={() => setDur(m)} className={"rounded-full px-3 py-1 text-xs font-semibold " + (Number(dur) === m ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-700")}>{m} min</button>
            ))}
          </div>
          <input type="number" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} placeholder="minutes (optional)" className="mb-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
          <p className="mb-4 text-xs text-stone-400">Activities during the walk tuck underneath it. Without a length, anything in the next 10 minutes counts.</p>

          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">Distance</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {[100, 250, 500, 750, 1000].map((mtr) => (
              <button key={mtr} onClick={() => setDist(mtr)} className={"rounded-full px-3 py-1 text-xs font-semibold " + (Number(dist) === mtr ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-700")}>{mtr < 1000 ? mtr + " m" : (mtr / 1000) + " km"}</button>
            ))}
          </div>
          <input type="number" inputMode="numeric" value={dist} onChange={(e) => setDist(e.target.value)} placeholder="metres (optional)" className="mb-4 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white active:bg-amber-700">{isNew ? "Add" : "Save changes"}</button>
        {onDelete && <button onClick={onDelete} className="rounded-xl bg-red-50 px-4 py-3 text-red-500 active:bg-red-100" aria-label="Delete">🗑️</button>}
      </div>
    </Sheet>
  );
}

function OneOffSheet({ target, onSave, onDelete, onClose }) {
  const isNew = !!target.isNew;
  const [name, setName] = useState(target.label || "");
  const [glyph, setGlyph] = useState(target.glyph || "💊");
  const [color, setColor] = useState(target.color || "sky");
  const [when, setWhen] = useState(toLocalInput(target.ts || Date.now()));
  const save = () => {
    const n = name.trim(); if (!n) return;
    onSave({ id: isNew ? undefined : target.id, ts: fromLocalInput(when), label: n, glyph: glyph || "⭐", color });
  };
  return (
    <Sheet title={isNew ? "Log a one-off" : "Edit one-off"} onClose={onClose}>
      <p className="-mt-2 mb-4 text-xs text-stone-400">A single entry (meds, vet visit, bath…) logged to history — no new button on the dashboard.</p>

      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">What happened</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vet visit, Meds, Bath" autoFocus className="mb-3 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />

      <div className="mb-3 flex items-center gap-2">
        <input value={glyph} onChange={(e) => setGlyph(e.target.value)} maxLength={2} className="w-14 rounded-xl border border-stone-200 bg-white py-2.5 text-center text-xl outline-none focus:border-amber-400" />
        <div className="flex flex-wrap gap-1">
          {EMOJI_SUGGEST.map((em) => (
            <button key={em} onClick={() => setGlyph(em)} className={"rounded-lg px-1.5 py-1 text-lg " + (glyph === em ? "bg-amber-100" : "bg-stone-50")}>{em}</button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {SWATCH_KEYS.map((k) => (
          <button key={k} onClick={() => setColor(k)} className={"h-8 w-8 rounded-full " + SWATCHES[k].btn.split(" ")[0] + (color === k ? " ring-2 ring-offset-2 ring-stone-400" : "")} aria-label={k} />
        ))}
      </div>

      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-stone-400">When</label>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mb-4 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400" />

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!name.trim()} className="flex-1 rounded-xl bg-amber-600 py-3 text-sm font-bold text-white active:bg-amber-700 disabled:opacity-40">{isNew ? "Log it" : "Save changes"}</button>
        {onDelete && <button onClick={onDelete} className="rounded-xl bg-red-50 px-4 py-3 text-red-500 active:bg-red-100" aria-label="Delete">🗑️</button>}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ family, customTypes, onRemoveCustom, onExport, onLeave, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard && navigator.clipboard.writeText(family); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-400">Family code</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-stone-100 px-3 py-2 text-sm font-bold text-stone-700">{family}</code>
          <button onClick={copy} className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-700 active:bg-amber-200">{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="mt-1.5 text-xs text-stone-400">Share this code so others join the same log.</p>
      </div>

      {customTypes && customTypes.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">Dashboard buttons</div>
          <div className="space-y-1.5">
            {customTypes.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
                <span className="text-lg">{c.glyph}</span>
                <span className="flex-1 text-sm font-semibold text-stone-700">{c.name}</span>
                <button onClick={() => onRemoveCustom(c.id)} className="text-xs text-stone-400 active:text-red-500">remove</button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-stone-400">Removing a button keeps its past entries in history.</p>
        </div>
      )}

      <button onClick={onExport} className="mb-2 w-full rounded-xl bg-stone-100 py-3 text-sm font-semibold text-stone-600 active:bg-stone-200">⬇️ Export data (JSON backup)</button>
      <p className="mb-4 text-xs text-stone-400">Saves a file with the full log to this device. Do it now and then whenever you want a snapshot.</p>

      <button onClick={onLeave} className="w-full rounded-xl bg-stone-100 py-3 text-sm font-semibold text-stone-600 active:bg-stone-200">Switch family / sign out of this log</button>

      <div className="mt-4 text-center text-[11px] font-medium text-stone-400">🐾 Puppy Log <b className="text-stone-500">v{APP_VERSION}</b> · {APP_BUILD}</div>
    </Sheet>
  );
}

function WhoPicker({ onPick, initial }) {
  const [val, setVal] = useState(initial || "");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {["Mum", "Dad", "Me"].map((n) => (
        <button key={n} onClick={() => onPick(n)} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-700 shadow-sm active:bg-amber-50">{n}</button>
      ))}
      <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onPick(val)} placeholder="or your name" className="w-24 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs outline-none focus:border-amber-400" />
      {val.trim() && <button onClick={() => onPick(val)} className="rounded-full bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white active:bg-amber-700">Set</button>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
