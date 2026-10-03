---
type: schema_definition
title: "Connection Tables"
description: "platform_accounts (the link to Steam) and platform_library_items (the synced, derived library with match provenance)."
tags: [models, connections, steam, library, playtime]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/connections.py
---

# Connection tables

## `platform_accounts`

| Column | Notes |
| --- | --- |
| `user_id`, `provider` | unique together: one link per provider per member |
| `provider`, `provider_account_id` | unique together: one member per upstream account (SteamID64, stored as a string) |
| `provider_username`, `provider_avatar_url`, `profile_url` | display mirror; refreshed on sync and allowed to go stale |
| `is_visible` | the member's showcase switch; hiding it also withdraws verified badges |
| `connected_at`, `last_synced_at`, `last_sync_status` | `last_synced_at` is written on every attempt and is the cooldown clock; status is `platform_sync_status` |

No third-party credentials are stored.

## `platform_library_items`

| Column | Notes |
| --- | --- |
| `platform_account_id` | FK, cascade; `(platform_account_id, provider_game_id)` is the upsert key |
| `provider_game_id`, `provider_title` | Steam appid and title; kept even when the game is unresolved |
| `game_id` | FK games, **SET NULL** on delete |
| `match_source` | `EXTERNAL_ID` (exact; may back a verified claim) or `TITLE` (trigram guess; never verified) |
| `playtime_minutes` | ≥ 0; same unit as `reviews.playtime_minutes` |
| `last_played_at`, `first_synced_at`, `last_synced_at` | |

Checks: `playtime_minutes_non_negative`, and the **one-directional**
`game_id IS NULL OR match_source IS NOT NULL`. A symmetric version would break
`ON DELETE SET NULL` when the catalog is re-imported. Indexes: a partial index
on `game_id` (resolved rows only) and `(platform_account_id, playtime_minutes DESC)`
for the showcase.

Related: [Platform connections](../domains/platform-connections.md) · [Catalog: game_external_ids](catalog.md#game_external_ids)
