# Firebase sign-in and rate limiting

## What it does
Firebase proves who the person is (Google or email/password). The API verifies the ID token
(Google's public keys, issuer, audience, expiry), then issues the same `cf13` session cookie as a
password sign-in. It links by **verified email to an existing account only**; it never creates a
company or account. Company isolation is unchanged (row-level security).

## One-time setup (you do this in the Firebase console, no secrets are shared)
1. Create a Firebase project; Authentication > Sign-in method: enable Email/Password and Google.
2. Authentication > Settings > Authorized domains: add the site's domain (localhost is allowed for dev).
3. Project settings > Your apps > Web app: copy apiKey, authDomain, appId (public identifiers).
4. Set on the API process (e.g. in `.env`):
   - `FIREBASE_PROJECT_ID=<project id>`
   - `FIREBASE_WEB_CONFIG={"apiKey":"...","authDomain":"...","appId":"..."}`
5. Restart the API. `GET /api/auth/config` then reports `firebase.enabled: true` and the sign-in
   screen shows "Continue with Google".
Without `FIREBASE_PROJECT_ID` the route answers 503 and the screen shows only password sign-in.

## Rate limiting (per IP, in memory)
All requests 900/min; sign-in/sign-up/firebase/password/switch 10/min and 60/h; other writes 90/min;
forecast/items reads 180/min. Over the limit: HTTP 429 + `Retry-After`.
Tune with `CF13_RATE_ALL`, `CF13_RATE_AUTH`, `CF13_RATE_AUTH_HOUR`, `CF13_RATE_WRITE`, `CF13_RATE_HEAVY`;
`CF13_RATE=off` disables (tests only). Behind a proxy, set Express `trust proxy` so the real IP is used.
