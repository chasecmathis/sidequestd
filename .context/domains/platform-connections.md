---
type: domain_concept
title: "Platform Connections (Steam)"
description: "Linking Steam via OpenID 2.0, syncing the owned-games library, resolving appids to catalog games, and the verified playtime badge."
tags: [domain, steam, connections, openid, playtime, verified]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/connections.py
---

# Platform connections (Steam)

## Why Steam only

Steam is an OpenID 2.0 provider and publishes owned games and playtime through
a documented Web API. PlayStation, Xbox and Nintendo have no public consumer
API. `ConnectionProvider` is an enum so that adding a provider means adding a
value, not reshaping the model.

## Linking flow

1. `GET /connections/steam/start` returns an authorize URL whose `state` is
   **signed and short-lived** (10 min). The state records the user and the
   client that began the flow (`web` or `native`).
2. Steam redirects the browser to `GET /connections/steam/callback`. This is the
   only endpoint entered by a third-party redirect. It authenticates on the
   signed state, **verifies the `openid.*` assertion by sending it back to
   Steam** (`steam.verify_callback`), and answers with a 302 to the web app or
   to `sidequestd://` with a result code. The redirect target comes from the
   signed state and never from a query parameter, which would make an open
   redirect.
3. Nothing stored is a third-party credential. The only secret is the app-level
   `STEAM_API_KEY`.

`realm` and `return_to` are always this API's own absolute URLs, built from
**`API_PUBLIC_URL`**. That value is configured, not derived from the request,
because behind a proxy the request would yield the internal address. Only the
hop *after* verification depends on the client.

## Native linking

On the web the whole flow is one line: `window.location.assign(authorizeUrl)`.
The callback redirects to `/settings/connections?connected=steam`, and the
page reads the query string.

On a phone, `Linking.openURL` would hand off to Safari and end the app's part
in the flow. Instead, `src/lib/steam-link.ts` opens a browser the app owns
(`ASWebAuthenticationSession` on iOS, a Custom Tab on Android) with
`start?client=native`. The final hop is
`sidequestd://settings/connections?…`, which the session intercepts and hands
back as a return value.

- **The scheme must match on both sides:** `NATIVE_APP_SCHEME` on the server
  and `scheme` in `app.json`. If they differ, the session never returns.
- **Failures come back to the phone too**, not only successes, because a
  refusal is exactly when the member needs to see the Connect button.
- **An unreadable state falls back to the web.** The state is what records
  which client began the flow, so without it there's no app to return to.
- **The outcome can arrive two ways.** Normally the session returns it. If the
  app was killed behind the browser, or Android routes the intent first, the OS
  delivers a deep link instead. The screen reads the query string as well, then
  clears it.
- The system browser shares cookies, so someone already signed in to Steam
  doesn't type a password. iOS shows a one-time "wants to use
  steamcommunity.com to sign in" prompt.

| Where the browser stops | Cause |
| --- | --- |
| `localhost:8000/api/v1/connections/steam/callback` | `API_PUBLIC_URL` is a loopback address (see [development](../architecture/development.md#mobile-on-a-device)) |
| `localhost:3000/settings/connections?error=state` | The state expired (10-min `STEAM_STATE_TTL_MINUTES`), usually during a first Steam sign-in with 2FA. Press Connect again |

## Rules that must keep holding

- One link per provider per member, **and one member per upstream account**
  (`uq_platform_accounts_provider_account`, which surfaces as a 409). Without
  the second constraint, two profiles could claim the same hours.
- **Verified playtime is `EXTERNAL_ID` matches only.** An appid resolves to a
  catalog game exactly through `game_external_ids`. Anything else falls back to
  a trigram title match recorded as `TITLE`, which is good enough to list on a
  showcase but **never** backs a verified badge.
- The badge is **derived, not stored**. It needs the link to be visible
  (`is_visible`), an `EXTERNAL_ID` match and playtime above zero. Hiding or
  unlinking withdraws it everywhere.
- A Steam profile whose game details are private returns an empty 200. That
  response is recorded as `PROFILE_PRIVATE`, not `FAILED`, so the client can
  tell the member how to fix it (`packages/core/src/connections.ts` `syncNotice`).
- Manual re-sync has a 60-minute cooldown (`SyncTooSoonError`).
  `last_synced_at` is written on every attempt. The library re-syncs daily,
  stalest first (`library-sync.yml`).
- The owner sees `ConnectionStatus`, which includes sync diagnostics. Everyone
  else sees `PlatformShowcase`, which carries no sync errors.

## Endpoints

`GET /me/connections` · `GET /me/connections/playtime` ·
`GET /users/{user_id}/connections` · `GET /connections/steam/start` ·
`GET /connections/steam/callback` · `POST /connections/steam/sync` ·
`PATCH /connections/steam/visibility` · `DELETE /connections/steam`

## Code

- API: `app/services/{connections,steam,library_sync}.py`,
  `app/api/v1/connections.py`, `app/schemas/connections.py`,
  `app/core/security.py` (OAuth state), `app/cli/sync_libraries.py`
- Clients: `packages/core/src/connections.ts`, web `src/app/settings/connections/`
  and `src/components/connections/`, mobile `app/settings/connections.tsx` and
  `src/lib/steam-link.ts`, `verified-playtime.tsx` and `platform-showcase.tsx`
  in both apps
- Tests: `test_connections_*.py`, `test_steam_sync.py`

Related: [Connection tables](../models/connections.md) · [Discovery: catalog import](discovery.md#catalog-import-spec-2)
