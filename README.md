# Sidequestd

**Letterboxd for video games, with an Instagram-style social feed.**

Sidequestd is a social network for people who play games. Members rate and
review the games they've played with half-star ratings, text, photos and short
clips. They follow friends, whose reviews and backlog activity fill a unified
Home feed. They discover trending and personalised picks, and keep four backlog
lists (To Be Played, Playing, Completed and Dropped). Accounts can be public or
private, with follow requests for private ones. Linking a Steam account adds
verified playtime to a member's reviews.

## The project

A monorepo with one API and two clients:

| Path | What it is |
| --- | --- |
| `apps/api` | FastAPI + PostgreSQL backend shared by both clients |
| `apps/web` | Next.js web client |
| `apps/mobile` | Expo (React Native) iOS and Android client |
| `packages/*` | Shared TypeScript: generated API types, client logic, design tokens |
| `infra/` | Docker Compose for local Postgres, MinIO and Mailpit |

## Documentation

This README is only an overview. Everything else lives in the knowledge bundle
under [`.context/`](.context/index.md), which is the single source of truth:

- **Getting started:** [Local development](.context/architecture/development.md)
- **What the product should do:** [Product spec](.context/product/spec.md) and [status and roadmap](.context/product/roadmap.md)
- **How it's built:** [Architecture](.context/architecture/index.md), [Domains](.context/domains/index.md), [Models](.context/models/index.md)
- **Deploying:** [Deployment runbook](.context/architecture/deployment.md)

Contributors, human or AI, should follow the upkeep rules in
[`CLAUDE.md`](CLAUDE.md) so the bundle stays current.
