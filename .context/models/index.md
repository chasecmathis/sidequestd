---
type: index
title: "Models"
description: "Map of database tables, enums, the wire contract, and the Alembic migration chain."
tags: [index, models, schema, database, migrations]
timestamp: 2026-10-04T03:26:35Z
resource: apps/api/app/models/
---

# Models

SQLAlchemy models live in `apps/api/app/models/`, and importing that package
registers every mapper for Alembic. Pydantic wire shapes live in
`apps/api/app/schemas/`. Database conventions such as UUID keys, DB-clock
timestamps and constraint naming are in
[Conventions](../architecture/conventions.md#database-conventions).

| Document | Tables / types |
| --- | --- |
| [Users and auth](users-and-auth.md) | `users`, `favorite_games`, `refresh_tokens`, `password_reset_tokens` |
| [Catalog](catalog.md) | `games`, `genres`, `platforms`, `game_genres`, `game_platforms`, `game_external_ids`, `game_aliases`, `trending_scores` |
| [Reviews](reviews.md) | `reviews`, `review_media`, `likes`, `comments` |
| [Social and backlog](social-and-backlog.md) | `follows`, `backlog_items` |
| [Notifications and devices](notifications-and-devices.md) | `notifications`, `device_tokens` |
| [Connections](connections.md) | `platform_accounts`, `platform_library_items` |
| [Enums](enums.md) | Every `StrEnum` and the Postgres enum type it maps to |
| [API contract](api-contract.md) | `CursorPage`, error bodies, feed envelopes, OpenAPI → TypeScript generation |

## Migrations

`apps/api/migrations/versions/`, a linear chain (oldest first):

1. `0a3d28fae88c` initial schema (the full SPEC §7 model)
2. `de134620f0fc` trigram search indexes
3. `274f9dd9efda` `backlog_items.status_changed_at`
4. `9c4e1b7a2f60` game ratings (IGDB's and the app's own)
5. `b7f1c93ad4e2` `game_count` on genres and platforms
6. `c58e0b31a7d4` partial descending index on `games.release_date`
7. `e2b7c41d9a83` `game_external_ids`
8. `f4a1c07e3b52` platform account links and synced libraries
9. `a91f6c30d7b2` push device tokens
10. `5d2e8b4c9a17` search relevance: `unaccent`, `search_normalize()`, generated search keys on `games` and `users`, `game_aliases` ← **head**

Every schema change needs a new revision. Add it to this list and to the
relevant model file, and log it in [log.md](../log.md).
