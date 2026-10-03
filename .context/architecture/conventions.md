---
type: system_architecture
title: "Cross-Cutting Conventions"
description: "Rules every slice follows: layering, privacy gate, keyset pagination, domain errors, transactional side effects, type generation and shared client code."
tags: [architecture, conventions, api, privacy, pagination, errors, codegen]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/
---

# Cross-cutting conventions

## API layering

`api/v1/<slice>.py` (router) → `services/<slice>.py` (logic) → `models/` (tables).
`schemas/` hold the wire shapes.

- **Routers stay thin.** A router resolves dependencies from `app/api/deps.py`
  (`DbSession`, `CurrentUser`, `OptionalUser`, `ClientContext`), calls one
  service function and maps the result to a schema.
- **Services never raise `HTTPException`.** They raise subclasses of
  `ServiceError` from `app/services/exceptions.py`, and each subclass carries
  its own `status_code`. `main.py` translates them to JSON. `ConflictError`
  (409) adds a `field` so a client can attach the message to the right input.
  This keeps services usable from the CLI jobs.
- **Reads and writes of one concept can live in different modules on purpose.**
  For example, the follow graph is *read* in `services/users.py` and *written*
  in `services/social.py`. Each module docstring says which half it owns.
- **SPEC references are part of the code.** Docstrings cite `SPEC §x.y`, which
  resolves to the matching section of [product/spec.md](../product/spec.md).
  Keep citations accurate when behaviour changes, and never renumber existing
  sections.

## The privacy gate

One SQL expression decides whether a viewer may see an account's content:
`content_is_visible_to(viewer_id)` in `services/users.py`. The awaited form is
`require_content_access`. Reviews, stats, backlog lists, likes, comments, the
feed and user search all go through it. A new surface that shows user content
**must** reuse it rather than re-derive the rule. See
[Profiles and privacy](../domains/profiles-and-privacy.md).

## Keyset pagination

Every list endpoint returns `CursorPage[T]` (`schemas/pagination.py`):
`{items, next_cursor}`, where `next_cursor` is `null` on the last page. Cursors
are opaque base64url encodings of `[sort_key, id]`, built by
`services/pagination.py`. Every ordering ends in the row id so that it is total.
OFFSET is never used (SPEC §9). Backlog lists are the deliberate exception (see
[Backlog](../domains/backlog.md)).

## Side effects ride the transaction

- Notifications are written only through `services/notifications.emit`. The
  function adds the row to the caller's session **without committing**, so a
  notification commits or rolls back together with the action that caused it.
- Push delivery is queued in `session.info` and dispatched from an
  `after_commit` hook, and dropped on rollback. It is a best-effort nudge, not
  a durable outbox. See [Notifications and push](../domains/notifications-and-push.md).
- Denormalised counters that a member can move (for example
  `games.rating_average`) are rewritten in the same transaction as the write.
  Counters that only a job can move (`genres.game_count`, `trending_scores`) are
  recomputed by that job.

## Wire contract and type generation

The API's OpenAPI schema is the contract. `npm run gen:types` exports it to
`packages/api-types/openapi.json` and regenerates `src/schema.d.ts`. The
hand-written aliases in `packages/api-types/src/index.ts` stop compiling when a
schema is renamed, which is the intended signal. **After changing any schema in
`apps/api/app/schemas/`, regenerate the types and fix both clients.** See
[API contract](../models/api-contract.md).

## Database conventions

- Surrogate UUID primary keys (`UUIDPrimaryKeyMixin`), except on join and edge
  tables, which use composite keys.
- Timestamps come from the database clock (`TimestampMixin`, `CreatedAtMixin`).
- `Base.metadata` has an explicit naming convention (`ix_`, `uq_`, `ck_`,
  `fk_`, `pk_`), so constraint names are stable. Name new constraints to match.
- Every schema change is a new Alembic revision in `apps/api/migrations/versions/`.

## Shared client code

The test for whether code belongs in `@sidequestd/core`: *would the answer differ
on a phone?* If not, it lives in `packages/core`, and neither app keeps its own
copy. That covers API transport, validation limits that mirror the server,
wording (notification sentences, status labels), path builders and the
providers. Rendering never goes in `core`. Each app owns its markup and
components, and the two apps' component directories deliberately mirror each
other. The three seams in `core` (`configureApi`, `SessionStore`,
`ThemeStorage`) are injected by each app, and the native-only seams (media
picker, push, Steam linking) live in `apps/mobile/src/lib/`. Details are in
[Shared packages](shared-packages.md) and [Mobile client](mobile-client.md).

Related: [Stack](stack.md) · [Folder structure](folder-structure.md) · [Models](../models/index.md)
