---
type: domain_concept
title: "Discovery: Catalog, Search, Trending, Recommendations"
description: "IGDB catalog import, browse and facets, trigram search, materialised trending scores, and deterministic SQL recommendations."
tags: [domain, catalog, igdb, search, trending, recommendations, discover]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/games.py
---

# Discovery: catalog, search, trending and recommendations

## Catalog import (SPEC §2)

- **No request ever calls IGDB.** `services/games_import.py`, run from the CLI,
  is the only code that does. It has two sources that share one `GameRecord`
  shape and one upsert path: the offline fixture `app/data/seed_games.json` (the
  default, needing no credentials) and the live IGDB API (`--igdb`, which
  needs `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`).
- The upsert is keyed on `games.external_id` (the IGDB id), so re-running an
  import is idempotent. `--all` can resume with `--after-id`. Flags and the
  destructive `--drop-existing` are covered in
  [Local development](../architecture/development.md#loading-the-games-catalog).
- The import also writes `game_external_ids` (Steam appids; see
  [Platform connections](platform-connections.md)) and refreshes the
  `genres.game_count` and `platforms.game_count` facet counts.
- `igdb_rating` stays on IGDB's 0–100 scale and is **never** folded into the
  app's own 1–10 `rating_average`. The two are shown side by side.
- The schedule is weekly, on Sundays (`catalog-sync.yml`).

## Browse and Discover

- `GET /games` browses the catalog with genre and platform facets and a sort,
  keyset-paged. Facet lists are ordered by `game_count`.
- `GET /games/discover` returns the Discover tab's first paint in one call:
  `trending`, `new_releases` (released on or before today; unreleased games are
  excluded) and `recommended`. Each section holds 12 games.
- The catalog is public. The viewer is resolved only to personalise results.
- Nullable sort keys (for example `release_date`) are wrapped in `COALESCE`
  with a sentinel. NULL breaks the keyset row comparison, and undated games
  would otherwise drop out of the list silently.

## Search (SPEC §6.6)

Search *filters* on a case-insensitive substring (ILIKE with the user's own
wildcards escaped) and *ranks* by `pg_trgm` similarity. GIN trigram indexes
cover `games.title`, `users.username` and `users.display_name`. A display-name
match is weighted 0.9 against a handle match. User results must not leak gated
data: `review_count` is null for a private account the viewer cannot see.
Search is rate limited to 60/min.

## Trending (SPEC §6.5, §6.11)

Trending is **materialised** into `trending_scores`, with one row per game per
window (`24h`, `7d`, `30d`). Discover only ever reads that table. Each run
rewrites a whole window: reviews count 3.0, backlog adds 1.0 and likes 0.5.
There is **no recency decay yet** (see `TODO(trending worker)`). The job runs
daily (`trending.yml`). With no activity in a window, the endpoint returns an
empty list and Discover says so. It never falls back to an unranked list.

## Recommendations (SPEC §6.4, §6.5)

Recommendations are plain aggregate SQL with no model and nothing persisted, so
the same rows always produce the same ranking. The tests depend on that.

- **Content signal (weight 0.6):** genre affinity from the viewer's ratings of 7
  and above and from their pinned favorites (each favorite counts like a 10).
- **Collaborative signal (weight 0.4):** games rated highly by up to 25
  neighbours whose ratings agree with the viewer's (within 4 points, summed per
  co-rated game).
- **Both signals are rescaled to 0..1 before blending.** Otherwise whichever
  signal produced larger raw numbers would decide the result.
- **Nothing the viewer already has an opinion about** is recommended: games
  they've reviewed, put on any backlog list, or pinned as a favorite.
- **Cold start:** trending, then popular all-time (most reviewed, with average
  rating as the tie-break), filtered after reading deep. Signed-out Discover
  takes the same path.
- **An instance with no activity gets an empty section**, never an arbitrary
  slice of the catalog. Ties break on the row id, so tests compare tied groups
  as sets.
- The same output feeds `GET /games/discover`'s `recommended` and the
  [Home feed](feed.md) blend.

## Endpoints

`GET /games` · `GET /games/genres` · `GET /games/platforms` ·
`GET /games/trending` · `GET /games/discover` · `GET /games/{game_id}` ·
`GET /search/games` · `GET /search/users`

## Code

- API: `app/services/{games,games_import,search,trending,recommendations,pagination}.py`,
  `app/api/v1/{games,search}.py`, `app/cli/{import_games,trending}.py`
- Clients: `packages/core/src/catalog.ts` (query-string contract), web
  `src/app/discover/` and `src/app/search/`, mobile `app/(tabs)/discover.tsx` and `search.tsx`
- Tests: `test_games_*.py`, `test_search.py`, `test_trending.py`, `test_recommendations.py`

Related: [Catalog tables](../models/catalog.md) · [Stack: jobs](../architecture/stack.md#scheduled-jobs-and-cli)
