# 🐶 Puppy Log — setup guide

A shared potty / walk / training log for the family. One web page, hosted free on GitHub Pages, with live sync across everyone's phones via Firebase.

It's two free accounts and about 15 minutes. You only ever edit **one block** in `index.html` (your Firebase keys).

---

## Part A — Firebase (the shared database)

1. Go to **console.firebase.google.com** → **Add project**. Name it (e.g. `puppy-log`), accept defaults. The free **Spark** plan is plenty.
2. In the project, open **Build → Firestore Database → Create database**. Choose **Production mode**, pick a region near you, and create it.
3. Open **Build → Authentication → Get started → Sign-in method**, and enable **Anonymous**. (This signs everyone in silently so bots can't touch your data — no logins for your family.)
4. Click the **gear ⚙ → Project settings**. Scroll to **Your apps**, click the **web** icon `</>`, register an app (any nickname, no Hosting needed). Firebase shows you a `firebaseConfig = { ... }` object — **copy those values**.
5. Open `index.html`, find the block near the top marked *"paste your Firebase config"*, and replace each `PASTE_…` placeholder with your real values.

### Firestore security rules

In **Firestore → Rules**, replace everything with this and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /families/{family}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

This lets only signed-in app users read/write, under your family's code. Good for a puppy log. (The family code is the privacy boundary — anyone who knows your URL **and** your code can join, so pick a non-obvious code.)

---

## Part B — GitHub Pages (the free hosting)

You're uploading **all** of these files together (keep them in the same folder):
`index.html`, `manifest.webmanifest`, `icon-512.png`, `icon-192.png`, `apple-touch-icon.png`, `favicon-32.png`.

**Option 1 — point and click**
1. Create a new repo at **github.com/new** (e.g. `puppy-log`). Make it **Public** (Pages is free for public repos).
2. **Add file → Upload files**, drag in all the files above, **Commit**.
3. In the repo: **Settings → Pages**. Set **Source = Deploy from a branch**, **Branch = main**, folder **/ (root)**, **Save**.
4. Wait ~1 minute. Pages shows your live URL, like `https://YOURNAME.github.io/puppy-log/`.

**Option 2 — one command** (if you have the [GitHub CLI](https://cli.github.com))
From the folder with all the files, run `gh auth login` once, then `./deploy.sh`. It creates the repo and pushes everything; you just flip the Pages toggle it prints at the end.

---

## Part C — The family

1. Send everyone the URL.
2. On first open, each person types the **same family code** (e.g. `rex-house-2026`). That's what links your phones to one shared log.
3. Each person taps their name (Mum / Dad / Me / custom) so entries are attributed.
4. **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: menu → Install app) for an app icon and full-screen feel.

That's it — taps on any phone show up on all of them within a second.

---

## Using it

- **Three big buttons** log No.1 💧, No.2 💩, and Walk 🐾 instantly.
- **Training 🦴** plus any **Custom events** you create (＋ Custom — set a name, emoji, colour; shared to everyone).
- **Tap any history row** to fix the time, change the type, set a walk's length, or delete it. **＋ Add entry** logs something that happened earlier.
- **Charts tab**: 7-day averages, daily activity, and a "potty by hour" chart to learn his routine.
- **⚙ Settings**: copy/share the family code, or switch families.

## Changing things later

Edit `index.html`, commit to GitHub, and Pages redeploys in about a minute. Your data lives in Firebase, so updating the page never touches the log.

## Notes

- Free-tier limits (Firestore + Pages) are far beyond what a family puppy log will ever use.
- Want stronger privacy (real per-person accounts) or a custom domain/icon? Both are easy add-ons — just ask.
