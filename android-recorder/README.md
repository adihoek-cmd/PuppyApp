# Puppy Log (Android app)

One app for the family: the live Puppy Log web app (same URL as the browser, so
web updates arrive as before) plus native GPS walk recording and Strava upload.
The website keeps working in any browser exactly as before, just without GPS.

## Build and install
Android Studio → open this folder → Run ▶ with the phone connected (USB debugging),
or Build → Build APK(s) and send `app/build/outputs/apk/debug/app-debug.apk`.
First launch: enter the family code once (the app has its own storage, separate from Chrome).

## How it works
- The page sees `window.PuppyNative` and uses it for: GPS recording when Walk is tapped,
  ending a recorded walk from "End walk", the poop-bag notification, saving the JSON
  backup / calendar reminders to Downloads, and copying the family code.
- ⚙ Settings → "Walk recording & Strava" opens the native screen (end / extend the walk,
  connect Strava, auto-upload, background permission).
- `puppylogwalk://start-walk` opens the app and starts a walk.

## Walk behaviour
- Ongoing notification with End walk.
- 120 min: "Still walking?" with End now / Extend (extend = no limit for this walk).
- 150 min without extending: stops by itself, trimmed to when you arrived; still uploads.
- Writes only `durationMin` and `distanceM` on the walk the page created.
