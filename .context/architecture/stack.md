---
type: system_architecture
title: "Technology Stack"
description: "Runtimes, frameworks, infrastructure, deployment and scheduled jobs for the API, web and mobile apps."
tags: [architecture, stack, infrastructure, deployment, jobs]
timestamp: 2026-10-03T21:25:55Z
resource: package.json
---

# Technology stack

## API — `apps/api`

| Concern | Choice |
| --- | --- |
| Runtime | Python ≥ 3.12, managed with `uv` |
| Web framework | FastAPI, served by uvicorn; all routes under `/api/v1` (`settings.api_v1_prefix`) |
| Persistence | PostgreSQL 17 through SQLAlchemy 2.0 async (`asyncpg`); migrations in Alembic |
| Validation | Pydantic v2 schemas; settings through `pydantic-settings` (`app/core/config.py`) |
| Auth | argon2id passwords, HS256 JWT access tokens (15 min), opaque rotating refresh tokens (30 days) |
| Rate limiting | slowapi, in-memory and per-process. It must move to Redis before running more than one replica |
| Media | Pillow for images; clip duration is read from the container. Files are stored in S3-compatible storage through boto3 |
| Email | aiosmtplib. Mailpit catches mail in dev |
| Outbound HTTP | httpx (IGDB, Steam Web API, Expo push) |
| Quality gates | ruff (lint and format), mypy `strict`, pytest against a **real** Postgres (`sidequestd_test`), with each test rolled back in a transaction |

## Web — `apps/web`

Next.js 15 (App Router), React 19, Tailwind CSS v4, Vitest and Testing Library.
It talks to the API with a bearer access token held in memory and an httpOnly
refresh cookie. See [Auth and sessions](../domains/auth-and-sessions.md).

## Mobile — `apps/mobile`

Expo SDK 54, React Native 0.81, expo-router 6, React 19.1. Builds go through EAS
(`eas.json`). The refresh token lives in `expo-secure-store`. Push notifications
use Expo's push service.

## Shared packages — `packages/*`

| Package | Role |
| --- | --- |
| `@sidequestd/api-types` | TypeScript types generated from the API's OpenAPI schema, plus hand-written aliases |
| `@sidequestd/core` | Everything both clients agree about: API transport, validation and presentation rules, and the session, backlog, notification and theme providers. Nothing that renders |
| `@sidequestd/design-tokens` | The "Editorial Noir" palette, shape, motion, fonts and brand geometry, emitted as CSS for the web and imported directly by mobile |

## Infrastructure

- **Local:** `infra/docker-compose.yml` runs Postgres 17, MinIO (S3) and
  Mailpit. `npm run infra:up`.
- **Production:** two images on Fly.io (`apps/api/fly.toml`, `fly.web.toml`).
  A merge to `main` builds and deploys both. See [Deployment](deployment.md) §7.
- **CI:** `.github/workflows/ci.yml` runs ruff, mypy and pytest for the API, and
  lint, typecheck, test and build for the web app.

## Scheduled jobs and CLI

There is no queue or worker process. Background work runs as CLI modules,
triggered by GitHub Actions cron on a throwaway Fly machine (how that works, and
its traps: [Deployment → Scheduled jobs](deployment.md#scheduled-jobs)):

| Job | Command | Schedule |
| --- | --- | --- |
| Trending recompute | `python -m app.cli.trending --all-windows` | daily 06:00 UTC (`trending.yml`) |
| Catalog sync from IGDB | `python -m app.cli.import_games --igdb …` | Sundays 07:00 UTC (`catalog-sync.yml`) |
| Steam library re-sync | `python -m app.cli.sync_libraries --limit 500` | daily 09:00 UTC (`library-sync.yml`) |
| Media catch-up | `python -m app.cli.process_media [--watch]` | manual; uploads normally process in FastAPI background tasks |
| Metadata backfill | `python -m app.cli.strip_media_metadata [--dry-run]` | one-off |
| OpenAPI export | `python -m app.cli.export_openapi <path>` | through `npm run gen:types` |

Related: [Folder structure](folder-structure.md) · [Conventions](conventions.md) · [Discovery](../domains/discovery.md)
