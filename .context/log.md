---
type: decision_log
title: "Architecture and Domain Change Log"
description: "Newest-first log of changes to architecture, schema, API contracts and domain rules."
tags: [log, decisions, changelog]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Change log

Add one entry per change that alters an API contract, a database schema, a
domain rule or the architecture. Newest first. Keep each entry short: what
changed, why, and which `.context/` files were updated.

Entry template:

```md
## YYYY-MM-DD — Short title
- **Change:** what changed, in one or two lines.
- **Why:** the reason or constraint behind it.
- **Docs:** the `.context/` files updated.
```

---

## 2026-10-03 — All documentation markdown moved into the bundle

- **Change:** The only `.md` files outside `.context/` are now the root
  `README.md` and `CLAUDE.md`, and `CLAUDE.md` forbids adding more. The six
  files below were moved and then deleted. Vendored and generated markdown
  (`ios/Pods`, `.venv`, `.pytest_cache`, `.expo`) is untouched.

  | Was | Now |
  | --- | --- |
  | `DEPLOY.md` | [architecture/deployment.md](architecture/deployment.md), almost verbatim with **§1–§7 numbering kept**. §6 known limits and the jobs table now point to the roadmap and [stack.md](architecture/stack.md) instead of repeating them. |
  | `apps/mobile/README.md` | [architecture/mobile-client.md](architecture/mobile-client.md). Device setup went to [development.md](architecture/development.md#mobile-on-a-device); the native push, Steam and reset-link details went to their domain files; the policy screens went to the new [domains/documents.md](domains/documents.md). The phase-by-phase "Status" narrative was dropped as history, and its decisions survive in mobile-client.md. |
  | `apps/mobile/PLAN.md` | [decisions/2026-08-mobile-port-plan.md](decisions/2026-08-mobile-port-plan.md), **verbatim**, because the file was never committed to git and had no other copy. The new `decisions/` section holds records like this. |
  | `packages/core/README.md` (also never committed), `packages/api-types/README.md` | [architecture/shared-packages.md](architecture/shared-packages.md) |
  | `apps/api/README.md` | Nothing was unique: its layout and commands were already in the bundle, and its "only auth is implemented" status was stale. |

- **Build change:** removed `readme = "README.md"` from
  `apps/api/pyproject.toml` and `COPY README.md` from `apps/api/Dockerfile`.
  I checked with `uv lock --check` and a wheel build with no README present.
- **Comment-only edits** repoint `DEPLOY.md §N` and README references to the
  bundle: `fly.toml`, both Dockerfiles, `docker-entrypoint.sh`,
  `.env.example`, `infra/docker-compose.prod.yml`, `next.config.ts`,
  `metro.config.js`, mobile `prose.tsx`, and `api-types/src/index.ts`.
- **Docs:** new `architecture/{deployment,mobile-client,shared-packages}.md`,
  `domains/documents.md`, and `decisions/`; updated the root, architecture and
  domains indexes, `stack.md`, `development.md`, `folder-structure.md`,
  `conventions.md`, `roadmap.md`, and the auth, notifications and
  platform-connections domain files.

## 2026-10-03 — Bundle becomes the single source of truth; SPEC.md and README folded in

- **Change:** Deleted root `SPEC.md`. Its content now lives in
  [product/spec.md](product/spec.md) with the **same § numbering**, so the
  roughly 745 `SPEC §x.y` citations across 208 files still resolve without
  editing any source. Cut `README.md` down to a short overview. Its content
  was distributed as follows: setup, tests, catalog loading and code generation
  went to [architecture/development.md](architecture/development.md); status,
  known limits and next work went to [product/roadmap.md](product/roadmap.md);
  per-slice design notes went into the matching domain files.
- **Spec edits made in the move (not verbatim):** §2 drops the
  stack-alternative suggestions, which are already decided. §6.3 and §11 say
  "stored as 1–10" instead of "0–10". §6.10 fixes comments at 1–500 characters
  instead of "e.g." §6.13 gains a **Connections** bullet, because the Steam
  code already cites §6.13. §7 and §8 now point to [Models](models/index.md)
  and the domain files instead of holding the greenfield sketch. "As built"
  notes record verified differences from the code.
- **Dropped as stale:** the README's "EXIF stripping not implemented" gap (it
  is implemented on both upload paths) and "push is post-MVP" (Expo push is
  built).
- **Correction to the baseline entry below:** it cited DMs as "SPEC §6.14",
  but no such section exists; the spec ends at §6.13. DMs are unspecified and
  are listed that way in the roadmap.
- **Why:** to keep one source of truth instead of three that drift (the README
  had already drifted).
- **Docs:** new `product/` section and `architecture/development.md`; updated
  root and architecture indexes, `folder-structure.md`, `conventions.md`, and
  the auth, profiles, social, reviews, interactions, feed, discovery, backlog
  and notifications domain files. Outside the bundle: `README.md`,
  `CLAUDE.md`, `DEPLOY.md`, `apps/api/README.md` and `apps/mobile/PLAN.md` now
  point here.

## 2026-10-03 — OKF knowledge bundle created; baseline recorded

- **Change:** Added `.context/` (OKF v0.2): architecture, domains and models,
  plus the upkeep rules in the root `CLAUDE.md`. No runtime code changed.
- **Baseline at this entry:**
  - Monorepo: `apps/api` (FastAPI, Python 3.12, SQLAlchemy 2 async, Alembic),
    `apps/web` (Next.js 15, React 19, Tailwind v4), `apps/mobile` (Expo SDK 54,
    expo-router 6, RN 0.81), and shared `packages/core`, `packages/api-types`
    and `packages/design-tokens`.
  - The Alembic chain has nine linear revisions, from `0a3d28fae88c`
    (initial schema) to the head `a91f6c30d7b2` (push device tokens). The full
    chain is in [models/index.md](models/index.md#migrations).
  - Implemented domains: auth, profiles and privacy, follow graph, reviews and
    media, likes and comments, Home feed (reviews, backlog activity and a
    recommended blend), discovery (catalog, search, trending and
    recommendations), backlog lists, notifications with Expo push, and Steam
    connections with verified playtime.
  - Not built yet: DMs (unspecified; see the correction above). Trending uses flat weights with no recency
    decay (see `TODO(trending worker)` in `app/services/trending.py`). Rate
    limiting uses per-process memory.
- **Comment cleanup audit:** I scanned every non-test source file under
  `apps/*` and `packages/*` for step-by-step comments, docstrings that only
  restate a name, and prose that describes parameter shapes. I found none worth
  removing. The comments explain *why* (SPEC references, invariants, rejected
  alternatives), and parameter shapes are already typed: mypy runs in `strict`
  mode, the API uses Pydantic v2 schemas, and the TypeScript is generated from
  OpenAPI. I edited no source files.
- **Drift noticed (not fixed here):** the README's layout section still calls
  `apps/mobile` "scaffold only" and leaves `packages/core` and
  `packages/design-tokens` out of the tree. `apps/web/package.json` does not
  list `@sidequestd/core`, which resolves through the npm workspace.
- **Docs:** every file under `.context/`; root `CLAUDE.md`.
