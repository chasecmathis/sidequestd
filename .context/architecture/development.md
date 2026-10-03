---
type: system_architecture
title: "Local Development"
description: "Prerequisites, running the stack locally, tests, loading the catalog, trending, and regenerating types, tokens and brand assets."
tags: [architecture, development, setup, testing, tooling]
timestamp: 2026-10-03T21:25:55Z
resource: package.json
---

# Local development

## Prerequisites

Docker (Postgres, MinIO, Mailpit), [uv](https://docs.astral.sh/uv/) and Node 20+.

## Run it

```bash
npm run infra:up       # 1. Postgres 17, MinIO, Mailpit
npm run api:install    # 2. API deps
npm run api:migrate    #    alembic upgrade head
npm run api:seed       # 3. offline catalog fixture (no IGDB account needed)
npm install            # 4. JS workspaces (web + packages)
npm run api:dev        # 5. API on :8000  (api:lan binds 0.0.0.0 for a phone)
npm run web:dev        # 6. web on :3000
```

Mobile installs on its own because it sits outside the workspace:
`cd apps/mobile && npm install && npm run start`.

| Service | URL |
| --- | --- |
| Web client | http://localhost:3000 |
| API / docs | http://localhost:8000 · http://localhost:8000/docs |
| Mailpit (all outgoing email, e.g. password-reset links) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

## Mobile on a device

On a simulator, `npm run api:dev` is enough. A physical phone can't reach
`localhost`, because that address is the phone's own loopback. The same
problem shows up in three forms:

1. **The API address.** Run `npm run api:lan` (uvicorn on `0.0.0.0`). In
   development the app infers the host from Expo's packager `hostUri` and the
   port from `api:dev`. `EXPO_PUBLIC_API_URL`, then `extra.apiUrl`, override
   that inference. Inference is skipped in production builds and behind
   `expo start --tunnel`. **Settings → Design system** prints the resolved
   `API: …`.
2. **Media URLs.** Avatars and uploads render blank on a device while cover art
   works, because media URLs are built from `S3_ENDPOINT_URL`
   (`localhost:9000`). In development, `mediaUrl` in `src/lib/api.ts` rewrites a
   loopback media host to the packager host. Setting `S3_PUBLIC_URL_BASE` to the
   machine's LAN address in `apps/api/.env` fixes it permanently, but you have
   to update it whenever the LAN address changes.
3. **Steam's `return_to`.** This one can't be inferred. Set
   `API_PUBLIC_URL=http://<LAN-IP>:8000` in `apps/api/.env`, or Steam sends
   the phone's browser to `localhost`. See
   [Platform connections](../domains/platform-connections.md#native-linking).

**Push, Steam linking and universal links need a development or store build**
(`npx expo run:ios`, or `eas build --profile development`). Expo Go can't
receive remote push (since SDK 53) or answer the `sidequestd://` scheme, and
entitlements and intent filters are applied at build time. Push also needs
`extra.eas.projectId` in `app.json` (from `eas init`); without it the app
logs the failure and falls back to polling. To test the reset screen
without any of this, run
`npx uri-scheme open "sidequestd://reset-password?token=…"`.

## Tests and checks

```bash
npm test             # design tokens + core + API (pytest) + web (vitest)
npm run lint         # tokens/brand checks, ruff, mypy, eslint
npm run format       # autofix
npm run api:test     # needs the Postgres container running
npm run web:test
npm run mobile:typecheck && npm run mobile:lint
```

The API suite runs against a **real Postgres** database (`sidequestd_test`,
created by `infra/postgres/init`). It applies the migrations and rolls each
test back in a transaction, so constraints, enum types and the migrations
themselves are all exercised. Network-crossing storage calls are stubbed, so
tests need Postgres but not MinIO.

## Loading the games catalog

```bash
npm run api:seed                                   # bundled fixture, offline
npm run api:seed -- --file mine.json               # your own fixture, same shape
npm run api:seed -- --igdb --limit 200             # one page of the best-rated games
npm run api:seed -- --igdb --all                   # the whole IGDB catalog
npm run api:seed -- --igdb --all --after-id 145280 # resume an interrupted run
npm run api:seed -- --igdb --all --max-pages 2     # trial run
```

- `--igdb` needs `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`. Without them it
  exits non-zero instead of silently importing nothing.
- Imports are idempotent and keyed on `external_id`. `--all` pages by id, not
  by offset, commits each page and prints the id it reached. Both live paths
  request main games only (`category = 0`), with no DLC, bundles or ports.
- The fixture is **development data**: 24 real games, of which only 16 have
  checked cover URLs. For anything real, run `--igdb` against a clean database.
- ⚠️ `--drop-existing` empties the catalog, and every FK to `games.id`
  cascades. That deletes **every review, backlog entry, favorite and trending
  score**. It asks you to type `drop` (or pass `--yes`) and refuses to run
  without a TTY.

## Trending and media jobs

```bash
npm run api:trending                    # default 7d window
npm run api:trending -- --all-windows   # 24h, 7d and 30d
npm run api:media [-- --watch]          # sweep PENDING media
```

With no activity, trending returns an empty list and Discover says so. It does
not fall back to an arbitrary list. Production schedules are listed in
[Stack](stack.md#scheduled-jobs-and-cli).

## Regenerating generated files

| Command | When | Writes |
| --- | --- | --- |
| `npm run gen:types` | after any API endpoint or schema change | `packages/api-types/openapi.json` and `src/schema.d.ts` (no DB needed). Commit both. |
| `npm run gen:tokens` | after editing `packages/design-tokens` palette or shape | `apps/web/src/app/tokens.generated.css` (`tokens:check` fails on drift) |
| `cd apps/mobile && npm run gen:grain` | after changing the grain's turbulence parameters | `apps/mobile/assets/grain.png` (deterministic: no diff unless a parameter changed) |
| `npm run gen:brand` | after editing the logomark geometry in `packages/design-tokens/src/brand.ts` | the favicon, touch icon, social card, PWA icons, iOS and Android app icons, splash marks and notification silhouette (`brand:check` fails on drift) |

The logomark is path data that both clients draw directly. The only literal
brand colours are the four hexes in `apps/mobile/app.json`, which the OS reads
before any JavaScript runs. `apps/mobile/src/theme/tokens.ts` explains which
they are.

Production deployment is covered in [Deployment](deployment.md).

Related: [Stack](stack.md) · [Folder structure](folder-structure.md)
