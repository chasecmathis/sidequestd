---
type: system_architecture
title: "Deployment Runbook"
description: "Production deployment on Fly.io: required environment, manual deploy, HTTPS cookie settings, post-deploy checks, continuous deployment, rollbacks and scheduled jobs."
tags: [architecture, deployment, fly, production, operations, runbook]
timestamp: 2026-10-04T03:26:35Z
resource: .github/workflows/ci.yml
---

# Deployment runbook

Two images, one database. This was the root `DEPLOY.md`, and its **section
numbers are unchanged**: comments in `fly.toml`, the Dockerfiles and
`next.config.ts` cite them as "deployment.md §7". Local development is in
[development.md](development.md).

A merge to `main` deploys on its own; [§7](#7-continuous-deployment) is the short
version and the one to read first. §1–§6 are what that automation is doing, and
the path to take when it is not available.

The API **refuses to start** when `ENVIRONMENT` is `staging` or `production` and
any setting below is still at its development default. It reports every problem
at once and exits non-zero before touching the database, so a missing variable
costs one failed boot rather than one redeploy each.

---

## 1. Required environment — API

Everything in this table has a default that works on a laptop and is rejected in
production. Nothing else is required.

| Variable                | Example                                                | Where it comes from                                                                                          |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ENVIRONMENT`           | `production`                                             | `production` or `staging`. This is the switch that turns on every check below.                                 |
| `DEBUG`                 | `false`                                                  | Must be false: debug logging records request detail that should not be retained.                               |
| `SECRET_KEY`            | `kBqf3n2Xk0…`                                            | `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Signs access tokens — rotating it logs everyone out. |
| `DATABASE_URL`          | `postgresql+asyncpg://user:pw@db.internal:5432/sidequestd` | Your managed Postgres 17. Note the `+asyncpg` driver; Alembic swaps it for `+psycopg` itself.                  |
| `REFRESH_COOKIE_SECURE` | `true`                                                   | Always true over HTTPS. See §4.                                                                                |
| `CORS_ORIGINS`          | `https://sidequestd.app,https://www.sidequestd.app`      | Comma-separated. Every browser origin that calls the API. HTTPS only, no localhost.                            |
| `WEB_APP_URL`           | `https://sidequestd.app`                                 | Base of the password-reset links that get emailed out, so it must be the address users actually reach.         |
| `SMTP_HOST`             | `smtp.resend.com`                                        | Any SMTP provider. Password reset (SPEC §6.1) is the only mail the app sends, so the volume is tiny.           |
| `SMTP_PORT`             | `587`                                                    | **587 only.** `app/core/email.py` passes `start_tls` and never `use_tls`, so the implicit-TLS port 465 is not supported — it would hang rather than fail cleanly. |
| `SMTP_USE_TLS`          | `true`                                                   | STARTTLS. False means plaintext, which is only right for the local Mailpit container.                          |
| `SMTP_USER`             | `resend`                                                 | From the mail provider, and provider-specific: Resend wants the literal `resend`, SendGrid the literal `apikey`, Postmark and Mailgun a real credential. |
| `SMTP_PASSWORD`         | —                                                        | The API key. Postmark uses its Server API Token as *both* user and password.                                   |
| `EMAIL_FROM`            | `no-reply@sidequestd.app`                                | Must be on a domain whose SPF/DKIM you control, or reset mail lands in spam.                                   |
| `S3_ENDPOINT_URL`       | `https://s3.us-east-1.amazonaws.com`                     | S3 or any S3-compatible service (R2, B2, Spaces). Holds avatars and review media (SPEC §6.2, §6.3).            |
| `S3_BUCKET`             | `sidequestd-media`                                       | Create it first; the app does not — **and make it publicly readable**, or every upload succeeds and then 403s on the way back. See "The bucket must be public" below. |
| `S3_REGION`             | `us-east-1`                                              | —                                                                                                              |
| `S3_ACCESS_KEY`         | `AKIA…`                                                  | An IAM user or scoped token with `GetObject`/`PutObject`/`DeleteObject` on that bucket and nothing else.        |
| `S3_SECRET_KEY`         | —                                                        | Issued with the access key.                                                                                    |

### The bucket must be public

The credentials above are the app's *write* path. Reads do not use them:
`storage.public_url()` hands the browser a plain `S3_PUBLIC_URL_BASE/<key>` URL,
which is fetched anonymously. **A private bucket therefore breaks every image
while leaving uploads working** — the object is stored, `avatar_url` is written,
and the browser gets a 403 and renders the `alt` text instead.

Locally this is already handled: `infra/docker-compose.yml` runs
`mc anonymous set download local/sidequestd-media` against MinIO. Nothing does
the equivalent in production, so it is a manual step on a new bucket:

```sh
# Tigris (Fly)
flyctl storage update sidequestd-media --public

# S3: bucket policy granting s3:GetObject to Principal "*"
# R2: enable public access, or bind a custom domain
```

Everything in the bucket is world-readable once this is on, review media
included. Keys are random UUIDs (`storage.build_key`), so they are unguessable
but unauthenticated: a private account's media is protected by URL secrecy
alone. Presigned URLs are the fix if that is not good enough, and they are a
code change, not a setting. Object *listing* stays denied either way, so the
bucket cannot be enumerated.

### Verifying, and the custom domain

Fetch a key that does not exist and read the error *code*, not the status — all
three failures below can surface as a 404:

```sh
curl -sS https://media.sidequestd.app/avatars/nope.jpg
```

| Code            | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `NoSuchKey`     | Correct. Public, and the host maps to the right bucket.               |
| `AccessDenied`  | Bucket is private. See above.                                         |
| `NoSuchBucket`  | The **custom domain is not registered with the bucket** — see below.  |

`NoSuchBucket` is the confusing one, because the bucket plainly exists. Tigris
resolves the bucket from the `Host` header, so an unregistered hostname is read
*as a bucket name*: the error will say `BucketName: media.sidequestd.app`, which
is the tell. A DNS CNAME alone does not do this — the domain has to be attached
to the bucket:

```sh
flyctl storage update sidequestd-media --custom-domain media.sidequestd.app
```

Until that is set, TLS to the custom domain also fails intermittently
(`tlsv1 alert internal error`) as only some edge nodes carry the certificate.

To confirm the bucket itself is fine independently of the domain, bypass it —
this endpoint always works and needs no custom-domain setup:

```sh
curl -sS https://sidequestd-media.t3.tigrisbucket.io/avatars/nope.jpg
```

If that says `NoSuchKey` and the custom domain says `NoSuchBucket`, the bucket is
healthy and only the domain mapping is wrong. Fix the mapping rather than
repointing `S3_PUBLIC_URL_BASE` and `NEXT_PUBLIC_MEDIA_URL` at the
`t3.tigrisbucket.io` host: every `avatar_url` already in the database contains
the public base that was configured when it was written, so changing the base
orphans all of them — and it costs a web rebuild besides.

Strongly recommended, not enforced:

| Variable               | Example                        | Why                                                                                                    |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `S3_PUBLIC_URL_BASE`   | `https://media.sidequestd.app` | The CDN in front of the bucket. Unset hands the bucket origin straight to clients.                       |
| `FORWARDED_ALLOW_IPS`  | `10.0.0.0/8`                   | Your load balancer's address or CIDR. Without it every client looks like the proxy to rate limits and to the IP recorded against each refresh token. `*` is only safe when nothing but the proxy can reach the port. |
| `WEB_CONCURRENCY`      | `4`                            | Uvicorn workers. Defaults to `2 × cores + 1`, capped at 8. See §6 before raising it.                     |
| `REFRESH_COOKIE_SAMESITE` / `REFRESH_COOKIE_DOMAIN` | `none` / `.sidequestd.app` | Only when the web client is on a different host than the API. See §4. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | — | Only for a live catalog sync. Register at <https://api-docs.igdb.com/#account-creation>. See §3. |

## 2. Required environment — Web

| Variable                | Example                        | Notes                                                                                      |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`   | `https://api.sidequestd.app`   | The API's **public** URL — the browser calls it directly. **Build-time**: Next inlines it into the client bundle, so it is a `--build-arg`, and pointing at a different API means a rebuild, not a restart. |
| `NEXT_PUBLIC_MEDIA_URL` | `https://media.sidequestd.app` | Match the API's `S3_PUBLIC_URL_BASE`. **Build-time** as well: `next/image` only loads hosts that `next.config.ts` allow-lists, and that list is baked into the build. Leave it unset and every uploaded avatar 400s. |
| `APPLE_TEAM_ID`         | `A1B2C3D4E5`                   | **Runtime**, optional. Serves `/.well-known/apple-app-site-association`. See §2a. |
| `ANDROID_CERT_FINGERPRINTS` | `AA:BB:…,DD:EE:…`          | **Runtime**, optional. Comma-separated. Serves `/.well-known/assetlinks.json`. See §2a. |

### 2a. Mobile app links — the password-reset URL

Optional, and the site is correct without them: unset, both files 404, every link
opens the web as it always has. What they buy is the one link that should not
finish in a browser. A reset completed on the web leaves the new password on an
account the phone is still signed out of, so somebody who asked to reset *from
the app* ends up back at a sign-in screen typing the password they just set.

Nothing in the API changes for this. The email already sends
`WEB_APP_URL/reset-password?token=…`; these two files are how iOS and Android
learn that `app.sidequestd.client` is allowed to answer it.

Both are **runtime** values — unlike the two `NEXT_PUBLIC_*` above, they are
never sent to a browser, so setting one is a restart rather than a rebuild.

Where to find them:

- **`APPLE_TEAM_ID`** — the ten-character prefix on your app identifier. Apple
  Developer → Membership details, or the `DEVELOPMENT_TEAM` an EAS build prints.
- **`ANDROID_CERT_FINGERPRINTS`** — normally **two**, and shipping one is how
  this quietly half-works. `eas credentials` prints the upload key's SHA-256;
  the Play Console → App integrity → App signing prints the key Play re-signs
  with, and *that* is the one a store install is verified against. List both.

> **Set them right or leave them unset — do not ship a placeholder.** Apple does
> not read this file from the device; it reads it through a CDN that caches the
> answer for up to 24 hours. A file naming the wrong team keeps breaking
> association for a day after you fix it, where a 404 breaks nothing.

Verify after deploying. Both must be `200 application/json`, over HTTPS, with no
redirect — Apple does not follow one:

```bash
curl -sSI https://sidequestd.app/.well-known/apple-app-site-association | head -2
curl -sS  https://sidequestd.app/.well-known/assetlinks.json | jq .

# What Apple's CDN actually has, which is the copy that matters:
curl -sS "https://app-site-association.cdn-apple.com/a/v1/sidequestd.app" | jq .

# On a connected Android device, after installing a build:
adb shell pm verify-app-links --re-verify app.sidequestd.client
adb shell pm get-app-links app.sidequestd.client   # want "verified"
```

The domain is pinned in `apps/mobile/app.json` (`ios.associatedDomains` and
`android.intentFilters`). If `WEB_APP_URL` ever moves — to `www`, or another
domain — that file moves with it, and it is a **new app build**, not a config
change.

### Template

`.env.production` at the repo root is gitignored. It feeds both the compose
interpolation and the API container.

```dotenv
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=                       # python -c "import secrets; print(secrets.token_urlsafe(48))"

DATABASE_URL=postgresql+asyncpg://sidequestd:CHANGEME@postgres:5432/sidequestd
POSTGRES_USER=sidequestd          # only for the bundled postgres service
POSTGRES_PASSWORD=CHANGEME
POSTGRES_DB=sidequestd

REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=lax       # 'none' if web and API are on different hosts
CORS_ORIGINS=https://sidequestd.app
WEB_APP_URL=https://sidequestd.app

SMTP_HOST=smtp.resend.com
SMTP_PORT=587                     # 587 only; 465 (implicit TLS) is not supported
SMTP_USE_TLS=true
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=no-reply@sidequestd.app

S3_ENDPOINT_URL=https://s3.us-east-1.amazonaws.com
S3_BUCKET=sidequestd-media
S3_REGION=us-east-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_PUBLIC_URL_BASE=https://media.sidequestd.app

FORWARDED_ALLOW_IPS=10.0.0.0/8
NEXT_PUBLIC_API_URL=https://api.sidequestd.app
NEXT_PUBLIC_MEDIA_URL=https://media.sidequestd.app
```

---

## 3. Deploy by hand

On Fly this whole section is the break-glass path — [§7](#7-continuous-deployment)
is what actually runs on a merge to `main`. It is still the sequence to read to
understand what a deploy *does*, and the compose rehearsal below is still the
fastest way to check a configuration change locally.

### Build

```bash
# API — context is apps/api, self-contained.
docker build -t sidequestd-api:$(git rev-parse --short HEAD) apps/api

# Web — context is the REPO ROOT (npm workspace), and both public URLs are
# baked in.
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.sidequestd.app \
  --build-arg NEXT_PUBLIC_MEDIA_URL=https://media.sidequestd.app \
  -t sidequestd-web:$(git rev-parse --short HEAD) .
```

### Migrate and start

The API image's entrypoint validates the configuration, runs
`alembic upgrade head`, then execs uvicorn. `upgrade head` on an already-current
database is a no-op, so it is safe on every boot and on every replica — nothing
extra to wire up for a normal rollout.

```bash
docker run -d --env-file .env.production -p 8000:8000 sidequestd-api:TAG
docker run -d -p 3000:3000 sidequestd-web:TAG
```

For a rollout where migration time matters, run it as its own job first and
start the replicas with migrations off, so they are not held in their start
period behind a long DDL:

```bash
docker run --rm --env-file .env.production sidequestd-api:TAG migrate
docker run -d --env-file .env.production -e RUN_MIGRATIONS=false … sidequestd-api:TAG
```

`RUN_MIGRATIONS` gates that implicit on-boot migration only. An explicit
`migrate` argument always runs one, whatever the flag is set to — otherwise a
platform that shares one environment between the migration job and the serving
containers, which is exactly what Fly does, would turn the deploy's single
migration into a silent no-op.

**Database role:** the search migrations run
`CREATE EXTENSION IF NOT EXISTS pg_trgm` and `… unaccent`, which need `CREATE`
on the database — the master user on RDS/Cloud SQL, where both are
allow-listed. If migrations run as a restricted role, have a DBA install both
extensions once and those statements become no-ops. Confirm `unaccent` is
available on the managed Postgres before deploying `5d2e8b4c9a17`.

**Search relevance migration (`5d2e8b4c9a17`):** adding the STORED generated
search columns rewrites `games` (about 350k rows on a full catalog) and `users`
under an exclusive lock: both tables are unreadable and unwritable while it
runs, so search, browse, sign-in and profile reads wait for it. Expect seconds
at that size. Its new indexes then build `CONCURRENTLY`, without blocking. Aliases stay empty until the next IGDB sync (Sunday's
`catalog-sync.yml`, or `npm run api:seed -- --igdb --all` by hand); search
works without them, only abbreviations wait.

### Single-box / rehearsal

`infra/docker-compose.prod.yml` builds and runs both images plus a Postgres
container. It is the fastest way to rehearse the whole sequence locally, and a
reasonable single-box deploy. (`infra/docker-compose.yml` is the *development*
dependency stack and has dev credentials in it — do not deploy that one.)

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
curl -fsS http://localhost:8000/health      # {"status":"ok","version":"0.1.0"}
```

### Seed the catalog

An empty catalog means an empty Discover and no search results, so do this once
after the first migration. The bundled fixture needs no credentials:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec api python -m app.cli.import_games
```

For the real catalog, set `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` and use
`--igdb`. The fixture is 24 games of development data, not a mirror of IGDB —
[Local development → Loading the games catalog](development.md#loading-the-games-catalog)
covers the difference, the resume flags, and why `--drop-existing` is destructive.

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec api python -m app.cli.import_games --igdb --all
```

`GET /games/trending` stays empty until `python -m app.cli.trending` has run. On
Fly that is scheduled for you (§7, *Scheduled jobs*); anywhere else, put
`python -m app.cli.trending --all-windows` on a daily cron before Discover
matters.

---

## 4. The HTTPS switches

Same-site deployment (web and API behind one domain, e.g. `sidequestd.app` and
`sidequestd.app/api`):

```dotenv
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=lax
CORS_ORIGINS=https://sidequestd.app
WEB_APP_URL=https://sidequestd.app
```

Cross-site deployment (`sidequestd.app` calling `api.sidequestd.app`) — the
refresh cookie will not be sent at all without all three:

```dotenv
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=none
REFRESH_COOKIE_DOMAIN=.sidequestd.app
CORS_ORIGINS=https://sidequestd.app,https://www.sidequestd.app
WEB_APP_URL=https://sidequestd.app
```

`SameSite=none` without `Secure` is rejected at startup in every environment,
because browsers silently drop such a cookie and the symptom is an app that
logs you out on every refresh.

Terminate TLS at the load balancer and set `FORWARDED_ALLOW_IPS` to it. `/docs`,
`/redoc` and the OpenAPI route are served only outside production; the generated
TypeScript clients in `packages/api-types` do not depend on the route.

---

## 5. After the first deploy

- [ ] `GET /health` returns `{"status":"ok"}` through the load balancer.
- [ ] Register an account, then confirm the password-reset email actually
      arrives — SMTP failures are logged, never raised, so a broken mail
      provider looks like success from the client.
- [ ] Upload an avatar and confirm it renders. Two different things break this,
      and they look identical in the UI — a broken image with its `alt` text.
      Tell them apart from the optimizer's status code rather than by guessing:

      ```sh
      curl -sS -o /dev/null -w '%{http_code}\n' \
        'https://sidequestd.app/_next/image?url=https%3A%2F%2Fmedia.sidequestd.app%2Favatars%2Fnope.jpg&w=256&q=75'
      ```

      - **400**, `"url" parameter is not allowed` — the host is not
        allow-listed. `next.config.ts` `images.remotePatterns` covers
        `images.igdb.com`, the local MinIO bucket, and whatever
        `NEXT_PUBLIC_MEDIA_URL` was set to **at build time**. A blank or wrong
        value there means every uploaded image 400s, and no restart fixes it —
        only a rebuild.
      - **anything else**, `upstream response is invalid` — the host is
        allow-listed and the fault is on the bucket side. Ask the bucket
        directly and read the error code, not the status: see §1, "Verifying,
        and the custom domain". `AccessDenied` is a private bucket,
        `NoSuchBucket` an unregistered custom domain. Neither needs a rebuild.
- [ ] Confirm `/docs` is 404 in production.

## 6. Known limits at this size

These are properties of the app as built, not of the deployment, so they live
in [Status and roadmap → Known limits](../product/roadmap.md#known-limits-fix-before-scaling).
The two that shape capacity planning are per-process rate limits and in-process
media processing (size memory for `WEB_CONCURRENCY` concurrent 100 MB uploads).

---

## 7. Continuous deployment

A push to `main` deploys. There is no approval gate: the four CI jobs are the
gate, and `.github/workflows/ci.yml` will not run the `deploy` job unless all of
them pass.

```
push to main
  └─ api ─┐
     web ─┤
  images ─┼─→ deploy ─→ cd apps/api && flyctl deploy   (release_command: alembic upgrade head)
   types ─┘             flyctl deploy --config fly.web.toml --build-arg …
                        smoke test                      (GET /health, /docs must 404)
```

Each `flyctl deploy` runs from the directory that is its build context, and
names no path. flyctl resolves a relative `--config` against the working
directory in some versions and against the PATH argument in others; running
from the build context root is the one form both readings agree on.

Five to seven minutes end to end. The API goes first and the two steps are
sequential, so a failed migration aborts the deploy before the new client ever
ships against a schema that does not exist.

Two details worth knowing:

- **Fly's remote builder builds the images**, from the same Dockerfiles. CI does
  not push a registry — no credentials, no image-tag plumbing. The `images` job
  is the PR-time guard against Dockerfile breakage, which is why it also asserts
  that the production guardrail still refuses a development default.
- **Migrations run as Fly's `release_command`**, on a throwaway machine on the
  new image, once per deploy, before any machine takes traffic. The serving
  machines have `RUN_MIGRATIONS=false` so they do not each repeat it.

### Where each setting lives

| Kind                     | Lives in                            | Examples                                                    |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| Non-secret API config    | `apps/api/fly.toml` `[env]`         | `ENVIRONMENT`, `CORS_ORIGINS`, `WEB_APP_URL`, `S3_BUCKET`     |
| Secret API config        | `fly secrets set --app sidequestd-api` | `SECRET_KEY`, `DATABASE_URL`, `SMTP_*`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Public URLs for the web build | GitHub repository **variables** | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MEDIA_URL`                |
| Deploy credential        | GitHub repository **secret**        | `FLY_API_TOKEN`                                               |
| Bucket state, not config | The storage provider                | Public-read on `S3_BUCKET` (§1). No env var controls it, nothing in the repo asserts it, and a deploy will not restore it. |

The `NEXT_PUBLIC_*` values are variables rather than secrets deliberately: they
are public URLs, they end up in the client bundle either way, and a wrong one is
the single easiest way to ship a broken deploy — so they should be readable in
the workflow log. The deploy job fails fast if any of the three is unset.

`fly secrets set` restarts the app on its own. A change to `fly.toml` `[env]`
only takes effect on the next deploy.

### Rolling back

Fly keeps the previous images, so a rollback is a redeploy of one:

```bash
flyctl releases --app sidequestd-api                     # find the last good version
flyctl deploy --app sidequestd-api --image <that image>  # no rebuild
```

A rollback does **not** undo a migration. Alembic downgrades are not tested here,
so a schema change that has to be reverted is a hand-written forward migration —
which is the usual reason to prefer additive migrations and a two-step
deprecation over a destructive one.

### Scheduled jobs

Fly has no built-in cron, and a Fly *scheduled machine* is created once and then
keeps running the image it was created from — long after the app has moved on. So
GitHub Actions is the scheduler and Fly runs the work:

The schedule itself (catalog sync Sundays 07:00 UTC, trending daily 06:00,
library sync daily 09:00) is tabled in
[Stack → Scheduled jobs](stack.md#scheduled-jobs-and-cli).

The catalog sync is weekly because a full IGDB walk burns the better part of an
hour of machine time; trending is three aggregate queries against our own
database and finishes in seconds, so it can afford to run daily. GitHub cron is
UTC with no DST handling and scheduled runs on shared runners can start well
late, so treat every time here as a hint.

The one ordering that is not arbitrary is the library sync at 09:00, *after* the
Sunday catalog sync. `sync_account` re-resolves every Steam appid against
`game_external_ids` on each run, so the catalog sync is what makes a newly
imported game matchable and the library sync is what actually goes and matches
it. Same day in the wrong order and every member waits an extra 24 hours for
badges the catalog already supports. Being cut short is safe: the CLI commits per
account and walks stalest-first, so an interrupted run keeps what it finished and
the next one resumes from there.

All three work the same way, and it is worth knowing why before adding a fourth:
the runner has no route to the Fly private network, so `DATABASE_URL` is
unreachable from GitHub. Each workflow resolves the app's *current* image, boots
a throwaway machine from it with the command as its entrypoint, polls until the
machine stops, reads the exit code back out of the machine's events, and destroys
it. Everything the command needs comes from `fly secrets`, which Fly injects into
any machine in the app — no job credentials live in GitHub beyond
`FLY_API_TOKEN`.

Two traps, both commented in the workflows: the machines pass
`--env RUN_MIGRATIONS=false`, because `fly machine run` injects app secrets but
**not** `fly.toml` `[env]`, and without it a scheduled job would run
`alembic upgrade head` against production as a side effect. And `--detach` is
required, because the attached form monitors machine *start*, not command exit.

All three are `workflow_dispatch`-able from the Actions tab, which is also how you
verify one after changing it. `library-sync` is the cheapest to verify: with no
linked accounts it prints `No linked accounts to sync.` and exits 0, which still
proves the image resolution, the secret injection and the exit-code readback.

### Not covered

`app.cli.process_media` has no schedule yet; it is tracked in the
[roadmap](../product/roadmap.md#known-limits-fix-before-scaling). Copy
`trending.yml` when adding one.
