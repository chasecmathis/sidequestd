---
type: schema_definition
title: "API Contract and Type Generation"
description: "Wire-level rules shared by every endpoint (pagination envelope, error bodies, union shapes) and how the TypeScript client types are generated from OpenAPI."
tags: [models, api, contract, openapi, typescript, pagination, errors]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/schemas/
---

# API contract and type generation

## Base

- Every route lives under `/api/v1`. Interactive docs are at `/docs` outside
  production. `GET /health` is the liveness probe.
- Auth uses `Authorization: Bearer <access JWT>`. Some reads accept anonymous
  callers (`OptionalUser`) and personalise or gate when a token is present.

## Shared shapes

| Shape | Where | Rule |
| --- | --- | --- |
| `CursorPage[T]` | `schemas/pagination.py` | `{items: T[], next_cursor: string \| null}`. Pass the cursor back verbatim as `?cursor=`; `null` means the last page. Cursors are opaque and carry no authorisation. |
| Error | `main.py` | `{detail: string}` with the `ServiceError.status_code`. A 409 adds `field`. A 429 adds `Retry-After`. A Pydantic 422 has `detail` as an array of per-field errors, which `packages/core/src/api.ts` flattens. |
| `ReviewSummary` / `ReviewDetail` | `schemas/review.py` | `rating` (1–10) **and** `stars` (0.5–5.0) both on the wire. |
| `FeedItem` | `schemas/feed.py` | Discriminated union on `type`. New kinds are new members. See [Home feed](../domains/feed.md). |
| Notification | `schemas/notification.py` | The parts of a sentence (actor, type, targets); not a union. |
| `ProfileStats` | `schemas/user.py` | Counts are 0; `average_rating` is **null** when there is no data. |
| `BacklogLists` | `schemas/backlog.py` | All requested statuses, empty ones included. Not cursor-paged. |
| `UserSearchResult` | `schemas/search.py` | `review_count` is null when the account is gated. |

## Generating client types

```bash
npm run gen:types
# = uv run python -m app.cli.export_openapi ../../packages/api-types/openapi.json
#   && openapi-typescript openapi.json --output src/schema.d.ts
```

- `packages/api-types/src/schema.d.ts` and `openapi.json` are **generated**.
  Do not edit them.
- `packages/api-types/src/index.ts` holds **hand-written** friendly aliases
  (`export type GameSummary = Schemas["GameSummary"]`). When a schema is renamed
  or removed, they fail to compile, which is the point.
- Both clients import types from `@sidequestd/api-types` and never redeclare
  API shapes.

**Any change under `apps/api/app/schemas/`** means: regenerate the types,
update the aliases if needed, update both clients, and record it in
[log.md](../log.md).

Related: [Conventions](../architecture/conventions.md#wire-contract-and-type-generation) · [Enums](enums.md)
