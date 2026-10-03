---
type: domain_concept
title: "Auth and Sessions"
description: "Registration, login, rotating refresh-token families with reuse detection, password reset, and dual-mode token delivery."
tags: [domain, auth, security, sessions, tokens]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/auth.py
---

# Auth and sessions

## Rules that must keep holding

- **Passwords:** argon2id, never returned by the API. Hashes are upgraded on
  login when the parameters change.
- **No account enumeration.** Login returns the same message for an unknown
  user and a wrong password, and spends the same hashing time on both.
  `POST /auth/password-reset` always returns 202.
- **Register** returns 201 and signs the user in. **Login** accepts an email
  *or* a username. **Logout** is idempotent, and `all_sessions` revokes every
  family.
- **Access tokens** are short-lived HS256 JWTs (15 min) and **cannot be revoked
  by design**.
- **Refresh tokens** are opaque strings that **rotate on every use**. Each login
  starts a *family*. If someone presents a token that has already been rotated,
  a copy has leaked, so the whole family is revoked.
- **Only SHA-256 digests are stored** for refresh and reset tokens, so a
  database leak yields no usable tokens.
- **Password reset:** single use, expires after 60 minutes, and only the newest
  link works. Confirming a reset consumes the token and signs the user out
  everywhere. The emailed link is `<web>/reset-password?token=…`.
- **Usernames and emails** are lower-cased on write. Check constraints enforce
  that, and uniqueness errors come back as a 409 with a `field`.
- **Rate limits** (slowapi, per-process): auth 10/min, password reset 5/hour.

## Dual-mode token delivery

Every auth response carries the token pair in its JSON body **and** sets the
refresh token as an httpOnly cookie, scoped to `/api/v1/auth`.

- **Web** keeps the access token in React memory only, never in
  `localStorage`, so an injected script finds nothing durable to steal. The
  browser sends the cookie (`credentials: "include"`). On page load the app
  calls `/auth/refresh` once, and the cookie restores the session.
- **Native** reads the refresh token from the body, stores it in
  `expo-secure-store` (never AsyncStorage), and sends `credentials: "omit"`.
  Logout sends the stored refresh token, so the server revokes it.
- `/auth/refresh` reads the token from the body first, then from the cookie.
  An `InvalidRefreshTokenError` also clears the cookie (`main.py`).
- The native secure-store item uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so a
  restored backup can't clone a live session onto another phone. Every store
  method swallows its own failures: an unwritable Keychain costs durability,
  not the running app.
- **Screens opt in to requiring a session**, one by one (`useRequireAuth()` on
  native). Discover, Search and profiles stay public, so the navigator itself
  is never gated.

## Password-reset link: a universal link, not a custom scheme

The emailed link is `https://<WEB_APP_URL>/reset-password?token=…`, and the API
never changes it. Phones route it to the app when it's installed (iOS universal
links, Android app links) and to the web otherwise. It must **not** be a
`sidequestd://` link: email is often read on a laptop, where a custom scheme
fails silently. (Steam can use `sidequestd://` safely because the app opened
the browser that lands on it.)

| Piece | Role |
| --- | --- |
| `apps/web/src/lib/app-links.ts` + `src/app/.well-known/` routes | Serve `apple-app-site-association` and `assetlinks.json` from `APPLE_TEAM_ID` / `ANDROID_CERT_FINGERPRINTS` |
| `ios.associatedDomains` in `apps/mobile/app.json` | `applinks:sidequestd.app` |
| `android.intentFilters` | `autoVerify`, https, host, `pathPrefix: /reset-password` |

- **Scoping lives in two places.** iOS scopes in the served file (only
  `/reset-password`). Android's file grants the whole host, and the app's
  intent filter narrows it, so widening it on Android requires an app release.
- **Absent is better than wrong.** Both routes return 404 when unconfigured.
  Apple caches the file through a CDN for up to 24 h, so a wrong Team ID stays
  broken for a day.
- A link without a token still opens the app, which offers to send a new one.
- Expo Router needs nothing extra: it strips the https origin and routes
  `app/(auth)/reset-password.tsx`. Changing the domain means a new app build.
  Environment variables and verification commands are in
  [Deployment](../architecture/deployment.md) §2a.

## Endpoints

`POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` ·
`POST /auth/logout` · `POST /auth/password-reset` ·
`POST /auth/password-reset/confirm` · `GET /users/username-available`

## Code

- API: `app/api/v1/auth.py`, `app/services/auth.py`, `app/core/security.py`,
  `app/api/cookies.py`, `app/core/rate_limit.py`, `app/core/email.py`
- Clients: `packages/core/src/auth.tsx` (provider; on a 401 it rotates and
  retries once), `packages/core/src/api.ts`, `apps/mobile/src/lib/session-store.ts`,
  `apps/mobile/src/lib/require-auth.ts`
- Tests: `apps/api/tests/test_auth_*.py`

Related: [Users and auth tables](../models/users-and-auth.md) · [Profiles and privacy](profiles-and-privacy.md)
