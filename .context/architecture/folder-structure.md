---
type: system_architecture
title: "Folder Structure"
description: "Monorepo layout: where each app, package, layer and kind of file lives."
tags: [architecture, monorepo, layout]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Folder structure

```
sidequestd/
├── apps/
│   ├── api/                      FastAPI backend (its own uv project)
│   │   ├── app/
│   │   │   ├── main.py           app factory, CORS, exception → HTTP mapping
│   │   │   ├── api/deps.py       DbSession, CurrentUser, OptionalUser, ClientContext
│   │   │   ├── api/cookies.py    web refresh-cookie helpers
│   │   │   ├── api/v1/           one router per slice; router.py fixes the include order
│   │   │   ├── core/             config, security (hashing/JWT/tokens), email, rate limits
│   │   │   ├── db/               declarative Base, naming convention, mixins, session
│   │   │   ├── models/           SQLAlchemy tables (see ../models/)
│   │   │   ├── schemas/          Pydantic request/response shapes (the wire contract)
│   │   │   ├── services/         domain logic; raises ServiceError subclasses
│   │   │   ├── cli/              jobs and one-off commands (python -m app.cli.<name>)
│   │   │   └── data/             seed_games.json (offline catalog fixture)
│   │   ├── migrations/versions/  Alembic revisions
│   │   └── tests/                pytest, one file per behaviour area
│   ├── web/                      Next.js client (npm workspace member)
│   │   └── src/
│   │       ├── app/              App Router routes (page.tsx + colocated *.test.tsx)
│   │       ├── components/       web-only rendering; ui/ holds primitives
│   │       └── lib/              providers, theme provider, app-links, cn
│   └── mobile/                   Expo client (NOT a workspace member, see below)
│       ├── app/                  expo-router routes: (auth)/, (tabs)/, settings/, …
│       └── src/
│           ├── components/       native rendering; ui/ holds primitives
│           ├── lib/              native seams: api, session-store, push, steam-link, media-picker
│           └── theme/            tokens → RN styles, fonts, typography, storage
├── packages/
│   ├── api-types/                openapi.json → src/schema.d.ts (generated) + src/index.ts aliases
│   ├── core/                     shared non-rendering client logic (see conventions)
│   └── design-tokens/            palette, shape, fonts, brand; cli/ emits CSS and brand rasters
├── infra/                        docker-compose for dev and prod; postgres init scripts
├── .github/workflows/            CI and the three scheduled jobs
├── README.md                     brief project overview only
├── CLAUDE.md                     agent instructions and bundle upkeep rules
└── .context/                     this knowledge bundle: the single source of truth
                                  and the only place documentation .md files live
```

## Notes

- **The route trees mirror each other.** Mobile's `app/` and web's
  `src/app/` route on the same paths (`/reviews/[id]`, `/profile/[username]`,
  and so on), because `@sidequestd/core` builds the path strings both clients
  use. Rename a route on both sides together. See `apps/mobile/src/lib/navigate.ts`.
- **`apps/mobile` sits outside the npm workspace.** Metro resolves modules from
  the package directory, and workspace hoisting creates duplicate React copies.
  Mobile takes the shared packages as `file:` dependencies and installs
  separately (`cd apps/mobile && npm install`).
- **Router include order matters.** Literal paths such as `/users/me/devices`
  and `/backlog/order` must be registered before parameterised siblings. See
  `apps/api/app/api/v1/router.py`.
- **Generated files:** `packages/api-types/src/schema.d.ts` and
  `packages/api-types/openapi.json` (run `npm run gen:types`), plus the outputs
  of the design-tokens CLI (`npm run gen:tokens`, `npm run gen:brand`). Never
  edit them by hand.

Related: [Stack](stack.md) · [Conventions](conventions.md)
