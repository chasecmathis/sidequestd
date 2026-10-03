---
type: schema_definition
title: "Catalog Tables"
description: "games, genres, platforms, their join tables, game_external_ids and trending_scores."
tags: [models, catalog, games, igdb, trending]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/game.py
---

# Catalog tables

All of these tables are **mirrored or derived** data. Only the import job and
the trending job write them, except `games.rating_average` and `rating_count`,
which review writes update.

## `games`

| Column | Notes |
| --- | --- |
| `external_id` (unique), `external_source` | IGDB id; the upsert key for imports |
| `title` (btree + GIN trigram), `slug` (unique), `summary`, `cover_url`, `release_date` | |
| `igdb_rating` (0–100, checked), `igdb_rating_count` | upstream score; null until synced; **never converted to 1–10** |
| `rating_average` (null when unrated, never 0), `rating_count` (≥ 0) | the app's own score, rewritten inside each review write |

Indexes: `ix_games_title_trgm` (search) and `ix_games_release_date_desc`
(partial, `release_date IS NOT NULL`; backs Discover's new releases).

Relationships: `genres` and `platforms` through `game_genres` and
`game_platforms`. `store_ids` is a **viewonly** relationship to
`game_external_ids`; it is not eager-loaded on browse pages.

## `genres`, `platforms`

`name` and `slug` (both unique) and `game_count`, which is denormalised and
recomputed only by the catalog import (`refresh_facet_counts`). There is no
index, because both tables are small.

## `game_external_ids`

Composite PK `(source, uid)`, plus `game_id` (indexed). `source` is a string,
not an enum, because IGDB's list of sources grows (`"steam"` today). Because
the PK is `(source, uid)`, one appid can name at most one game. This exact
mapping is the basis of verified playtime.

## `trending_scores`

PK `(game_id, window)`, plus `score` and `computed_at`. `window` is one of
`24h`, `7d`, `30d` (`TrendingWindow`). Each job run rewrites a whole window.
Index: `(window, score DESC)`.

Related: [Discovery](../domains/discovery.md) · [Connections](connections.md)
