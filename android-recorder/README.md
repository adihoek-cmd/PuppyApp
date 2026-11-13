# Puppy Log Walk (Android)

Records the GPS route of a dog walk, writes the time and distance back to the
Puppy Log walk, and uploads the route to the walker's own Strava account
(through the `puppy-strava` Worker).

## Build and install
1. Android Studio → File → Open → this `android-recorder` folder. Let it sync
   (it creates the Gradle wrapper and downloads the Android plugin the first time).
2. Plug in the phone (USB debugging on) → Run ▶, or Build → Build APK(s) and
   send `app/build/outputs/apk/debug/app-debug.apk` to each family phone.

No libraries and no `google-services.json`: it talks to Firestore over REST with
the same public web config and anonymous sign-in as the PWA.

## Use
- In the Puppy Log PWA on that phone: ⚙ Settings → "Record walks with GPS" → on.
  Tapping Walk then opens this app, which starts recording and steps back.
- Or open the app and tap Start walk (enter the family code + your name once).
- Connect Strava once per person. Tap "Let it run in the background" on Samsung.

## Behaviour
- Ongoing notification with End walk.
- 120 min: "Still walking?" alert with End now / Extend (extend = no limit for this walk).
- 150 min without extending: stops by itself, trimmed to when you arrived where you
  then stayed; the trimmed walk still uploads to Strava.
- Ending the walk in the PWA stops the recording within about a minute and keeps
  the duration entered there; deleting the walk stops it without saving.
- Writes only `durationMin` and `distanceM` on the existing walk (same fields as the watch).
