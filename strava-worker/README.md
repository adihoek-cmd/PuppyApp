# puppy-strava — Puppy Log ↔ Strava bridge

Cloudflare Worker that holds the Strava client secret and each family member's
Strava tokens (in KV). Devices keep only an opaque connection id.

Deploy:
```
cd strava-worker
npx wrangler login
npx wrangler kv namespace create STRAVA      # paste the id into wrangler.toml
# put the Strava Client ID into wrangler.toml (STRAVA_CLIENT_ID)
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler deploy
```
Strava "Authorization Callback Domain": `puppy-strava.adi-hoek.workers.dev`

Endpoints: `/connect?pair=P` → Strava → `/callback`; device polls `/pair?id=P`
for `{conn, athlete}`. Then `Authorization: Bearer <conn>` on `/me`,
`POST /upload?name=&external_id=` (GPX body), `/upload-status?id=`, `POST /disconnect`.
No Firestore paths are touched.
