---
type: index
title: "Sidequestd Knowledge Bundle"
description: "Master discovery map for the Sidequestd OKF bundle — start here before touching code."
tags: [index, okf, discovery]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Sidequestd Knowledge Bundle

Sidequestd is "Letterboxd for video games with an Instagram-style social feed":
one FastAPI backend serving a Next.js web client and an Expo mobile client.

This bundle is the **single source of truth** for the project. The root
`README.md` is only an overview. Each file says what a concept is, which rules
are load-bearing, and where the code lives. The detailed *why* stays in the
module docstrings it points at. Code comments that cite **`SPEC §x.y`** refer
to [product/spec.md](product/spec.md), which keeps the original section
numbers. The production runbook is [architecture/deployment.md](architecture/deployment.md).

**No documentation markdown lives outside this folder** except the root
`README.md` (overview) and `CLAUDE.md` (agent instructions).

## How to use it

1. Find the area you are changing below, and open its `index.md`.
2. Read the concept file, then the code paths in its `resource` field.
3. After the change, follow the upkeep rules in [`CLAUDE.md`](../CLAUDE.md).

## Sections

| Section | What it covers |
| --- | --- |
| [Product](product/index.md) | The product specification (what code cites as `SPEC §x.y`), plus the live status, known limits and roadmap. |
| [Architecture](architecture/index.md) | Stack, repository layout, local development, deployment, the mobile client, the shared packages, and the cross-cutting conventions every slice follows. |
| [Domains](domains/index.md) | One file per product area: auth, profiles and privacy, social graph, reviews, interactions, feed, discovery, backlog, notifications, platform connections. |
| [Models](models/index.md) | Database tables, enums and the wire contract: what each table holds, its constraints, and which migration introduced it. |
| [Decisions](decisions/index.md) | Archived long-form decision records, such as the mobile port plan, kept verbatim as history. |
| [Log](log.md) | Changes to architecture, schema and domain rules, newest first. |

## Quick lookup

| If you are touching… | Read |
| --- | --- |
| Setting up or running the project | [Local development](architecture/development.md) |
| A requirement, or code that cites `SPEC §x.y` | [Product spec](product/spec.md) |
| What's built, missing or fragile | [Status and roadmap](product/roadmap.md) |
| An API endpoint's request or response shape | [API contract](models/api-contract.md), then the domain file |
| A table, column or constraint | [Models index](models/index.md), then the [migrations note](models/index.md#migrations) |
| Who can see what | [Profiles and privacy](domains/profiles-and-privacy.md) |
| Anything shown in both clients | [Conventions: shared client code](architecture/conventions.md#shared-client-code) |
| A scheduled job or CLI command | [Stack: jobs](architecture/stack.md#scheduled-jobs-and-cli) |
| Tokens, sessions, cookies | [Auth and sessions](domains/auth-and-sessions.md) |
| Deploying, production env vars, rollbacks | [Deployment](architecture/deployment.md) |
| A mobile screen or component | [Mobile client](architecture/mobile-client.md) |
| `packages/core`, `api-types` or `design-tokens` | [Shared packages](architecture/shared-packages.md) |
