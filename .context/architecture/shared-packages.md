---
type: system_architecture
title: "Shared Packages"
description: "What @sidequestd/core, api-types and design-tokens hold, the three platform seams, import rules, and how each package is generated or tested."
tags: [architecture, packages, core, api-types, design-tokens, monorepo]
timestamp: 2026-10-03T22:10:00Z
resource: packages/
---

# Shared packages

## `@sidequestd/core`

Everything the web and native clients agree about: API transport, every
presentation and validation rule, the four providers (session, backlog,
notifications, theme), and the product's own words.

**The test for what belongs here: "would the answer differ on a phone?"** If
not, it lives here and neither app keeps a copy. **Nothing that renders** goes
here. A `ReviewCard` is a `<div>` on one platform and a `<View>` on the other,
and only its logic (`excerpt`, `formatStars`, `timeAgo`, `releaseYearLabel`) is
shared. Colours and shape belong in `design-tokens`.

### The three seams

A platform declares itself in exactly three places, each a named type rather
than a `Platform.OS` branch, so they are easy to grep:

| Seam | Decides | Web | Native |
| --- | --- | --- | --- |
| `configureApi` | whether fetch attaches the refresh cookie | `credentials: "include"` | `"omit"` |
| `SessionStore` (`read`/`write`, async) | where the refresh token lives | `cookieSessionStore` (no-ops; the httpOnly cookie is the store) | `expo-secure-store` |
| `ThemeStorage` | where the colour preference lives, and how the device reports its own | `browserThemeStorage` (`localStorage` + `matchMedia`) | `AsyncStorage` + `Appearance` |

The access token is kept in React state on **both** platforms and never
persisted. `configureApi` must run before any component can fire a request,
so both apps call it at **module scope** (`apps/web/src/lib/providers.tsx`,
`apps/mobile/src/lib/api.ts`), not inside an effect.

### Importing

Import from the package root (`import { useAuth, formatStars } from
"@sidequestd/core"`). Subpath entry points exist for two cases only:

- **`vi.mock` in tests.** Mocking the barrel doesn't reach a module imported
  directly by another module (`backlog-store.tsx` uses `./auth`), so mock the
  deep path.
- **Next.js server components.** `layout.tsx` imports `THEME_STORAGE_KEY` from
  `@sidequestd/core/theme-keys`. Through the barrel it comes via a
  `"use client"` module and silently resolves to `undefined`. See
  `src/theme-keys.ts`.

Tests: `npm run core:test`. They came over with the modules when core was
extracted from `apps/web/src/lib`.

## `@sidequestd/api-types`

TypeScript types for the API. `src/schema.d.ts` and `openapi.json` are
**generated** by `npm run gen:types` and committed, so a fresh checkout can
typecheck without a Python toolchain. `src/index.ts` holds hand-written
aliases (`UserMe`, `AuthSession`, …), so a rename upstream fails to compile
instead of drifting silently. See [API contract](../models/api-contract.md).

## `@sidequestd/design-tokens`

The Editorial Noir system as data: `palette.ts` (with the colour reasoning),
`shape.ts` (radius, elevation, motion, type), `fonts.ts` (roles and
per-platform bindings) and `brand.ts` (the logomark as path data). The web
consumes the generated `apps/web/src/app/tokens.generated.css`, and native
imports the objects directly. Regenerate with `gen:tokens` and `gen:brand`; the
`tokens:check` and `brand:check` lint steps fail on drift. See
[Local development](development.md#regenerating-generated-files).

## Adding a workspace package

When `apps/web` starts importing a new package under `packages/`, add it to
`apps/web/Dockerfile` in **two** places: its `package.json` in the `deps`
stage (so `npm ci` links it) and its source in the `builder` stage. Local
builds will still pass without this, because the whole repo is on disk; only
the image build fails. Mobile needs a `file:` dependency in
`apps/mobile/package.json` instead.

Related: [Conventions](conventions.md#shared-client-code) · [Mobile client](mobile-client.md)
