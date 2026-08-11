# Deploying Sidequestd

Two images, one database. [`SPEC.md`](./SPEC.md) is the product source of truth
and [`README.md`](./README.md) covers local development — neither is repeated
here.

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
| `S3_BUCKET`             | `sidequestd-media`                                       | Create it first; the app does not.                                                                             |
| `S3_REGION`             | `us-east-1`                                              | —                                                                                                              |
| `S3_ACCESS_KEY`         | `AKIA…`                                                  | An IAM user or scoped token with `GetObject`/`PutObject`/`DeleteObject` on that bucket and nothing else.        |
| `S3_SECRET_KEY`         | —                                                        | Issued with the access key.                                                                                    |

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

**Database role:** the search migration runs
`CREATE EXTENSION IF NOT EXISTS pg_trgm`, which needs `CREATE` on the database —
the master user on RDS/Cloud SQL, where `pg_trgm` is allow-listed. If migrations
run as a restricted role, have a DBA install the extension once and the migration
becomes a no-op.

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
README's *Loading the games catalog* covers the difference, the resume flags, and
why `--drop-existing` is destructive.

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production \
  exec api python -m app.cli.import_games --igdb --all
```

`GET /games/trending` stays empty until `python -m app.cli.trending` has run, and
it is a CLI command rather than a scheduled worker (SPEC §6.11) — put it on a
cron before Discover matters.

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
- [ ] Upload an avatar and confirm it renders. `next.config.ts`
      `images.remotePatterns` allow-lists the hosts `next/image` will load:
      `images.igdb.com`, the local MinIO bucket, and whatever
      `NEXT_PUBLIC_MEDIA_URL` was set to **at build time**. A blank or wrong
      value there means every uploaded image 400s, and no restart fixes it.
- [ ] Confirm `/docs` is 404 in production.

## 6. Known limits at this size

These are properties of the app as built, not of the deployment. README's
*Before deploying anywhere real* has the full list; the two that shape
capacity planning:

- **Rate limits are per process.** slowapi keeps its counters in memory, so `N`
  uvicorn workers × `M` replicas each enforce `RATE_LIMIT_AUTH` separately — a
  `10/minute` login limit is really `10 × N × M`. Set `WEB_CONCURRENCY=1` if
  that matters more than throughput, or point slowapi at Redis.
- **Media processing runs in-process** on FastAPI background tasks, and a
  100 MB clip is read fully into memory on the way to the bucket. Size the
  container's memory for `WEB_CONCURRENCY` concurrent uploads.

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

### Not covered

`app.cli.trending` and `app.cli.process_media` still need a schedule (SPEC
§6.11). Fly has no built-in cron; either a scheduled machine or an external
scheduler hitting `flyctl machine run` works. Until one exists,
`GET /games/trending` stays empty.
