---
type: decision_log
title: "Search Relevance (2026-10)"
description: "Design for typo-, accent- and word-order-tolerant game search with aliases and popularity ranking, social-graph-aware user search, and one shared client search hook."
tags: [decisions, search, discovery, pg_trgm, unaccent, social-graph, core, plan]
timestamp: 2026-10-04T03:26:35Z
resource: apps/api/app/services/search.py
---

> **Status: built, 2026-10-04** (migration `5d2e8b4c9a17`). Current
> behaviour lives in [Discovery: search](../domains/discovery.md#search-spec-66);
> where this record and that file disagree, that file and the code win. The
> task-by-task record is the [implementation plan](2026-10-search-relevance-plan.md).
>
> **Deviations found while building**, measured on a 350k-row catalog:
> - Aliases are matched through a `UNION ALL` of candidates, not
>   `EXISTS … OR`, which forced a sequential scan (1.5 s against 22 ms).
>   Scores are computed inside each branch and reduced per game.
> - Query words under 3 characters are left out of the all-words condition,
>   and "short" is judged on the compact form, because a pattern with no
>   trigram makes the GIN index return every row.
> - Patterns are inlined as SQL literals (`literal_execute`), so a generic
>   prepared-statement plan cannot hide them from the index.
> - No `@`-stripping code: `search_normalize` treats `@` as punctuation.
> - `[^[:alnum:]]` rather than `[^a-z0-9]`, so non-Latin names stay
>   searchable.
> - The exact-match bonus applies to every key (title, alias, handle, display
>   name), not only handles.
> - A page-one failure in `useSearch` clears the results, because they answered
>   an older term.

# Search relevance

## Goal

Make SPEC §6.6 search find what the reader meant. The three goals agreed for
this round are:

1. **Game relevance.** The right game comes back despite typos, word order,
   accents, punctuation and common abbreviations, and with a popular game
   ahead of an obscure one that has the same name.
2. **Finding people.** Accounts the viewer already has a connection to rank
   ahead of strangers, and `@handle` works as typed.
3. **Code health.** One shared search hook in `packages/core` replaces the
   five hand-written copies in the clients.

**Out of scope:** search filters (platform, year, genre), the query held in
the URL, recent and trending searches, a combined games-and-people view, and
any dedicated search engine. These are possible follow-ups. The API response
shapes do not change.

## Where search stood (2026-10-03)

- `services/search.py` filters on `ILIKE '%q%'` and ranks by
  `similarity()`. Trigram similarity only ranks results, so a typo ("eldin
  ring") returns nothing. A query whose words are not contiguous in the title
  ("witcher wild hunt") also returns nothing.
- Nothing is accent- or punctuation-insensitive: "pokemon" misses "Pokémon"
  and "spiderman" misses "Spider-Man".
- IGDB `alternative_names` are not imported, so "GTA V", "BotW" and "FF7"
  find nothing.
- Ranking ignores popularity. Against the full IGDB catalog (about 350k main
  games), "mario" can rank obscure titles above Super Mario Odyssey.
- User ranking ignores the follow graph, and "@ripley" misses because `@` is
  taken literally.
- A 1–2 character query is `ILIKE '%a%'`, which no trigram index can serve, so
  it scans the whole table.
- Debounce and fetch logic is duplicated across web `search/page.tsx`, mobile
  `(tabs)/search.tsx`, web `favorite-games.tsx`, web `reviews/new/page.tsx` and
  mobile `game-picker.tsx`. Only the two search pages guard load-more against
  stale responses.

## Approaches considered

- **A. Postgres-native: `unaccent`, normalized generated columns, an alias
  table, a multi-condition trigram filter and a blended score. Chosen.** It
  needs no new infrastructure (the app runs on Fly.io with one Postgres), and
  privacy gating stays in SQL through `content_is_visible_to`. The cost is
  that ranking weights are tuned by hand against a test suite.
- **B. A dedicated engine (Meilisearch or Typesense).** It would give better
  typo and prefix handling with no tuning. It was rejected because it means a
  new service, a sync path for catalog and profile edits, and drift handling.
  More importantly, user search needs per-viewer privacy and graph data that
  lives in Postgres: we would either run two systems or copy the social graph
  into the index. If tuning A proves insufficient, games alone can move to B
  later without changing the API contract.
- **C. Postgres full-text search (`tsvector`).** Rejected. Stemming adds little
  for short titles and handles, and full-text search does nothing for typos.

## Design

### 1. Normalization

- The migration runs `CREATE EXTENSION IF NOT EXISTS unaccent` and defines
  `search_normalize(text) RETURNS text IMMUTABLE`. The function strips accents
  with `unaccent('public.unaccent'::regdictionary, …)`, lowercases, collapses
  every run of non-alphanumerics to one space, and trims. The explicit
  dictionary argument is what makes the `IMMUTABLE` wrapper safe. Plain
  `unaccent()` is only `STABLE`, so it cannot back a generated column or index.
- The incoming query is normalized by the same SQL function, so the query and
  the stored key can never disagree.
- Example: "The Witcher 3: Wild Hunt" becomes key `the witcher 3 wild hunt`
  and compact form `thewitcher3wildhunt`.

### 2. Game search

**Schema**

- `games.search_key` is `GENERATED ALWAYS AS (search_normalize(title)) STORED`.
- `games.search_compact` is the same key with spaces removed, also generated
  and stored.
- Both get GIN `gin_trgm_ops` indexes, and `search_key` also gets a btree
  `text_pattern_ops` index for short-query prefix matching.
  `ix_games_title_trgm` is dropped. The plain btree on `title` stays.
- The new table `game_aliases` holds `id`, `game_id` (an FK to `games` with
  `ON DELETE CASCADE`, indexed) and `alias` (`String(300)`), plus the same two
  generated columns and GIN indexes. It has a unique constraint on
  `(game_id, search_key)` so that aliases differing only in case or accent
  collapse to one row.

**Import**

- `alternative_names.name` is added to `IGDB_FIELDS`.
- `GameRecord` gains `aliases: tuple[str, ...] = ()`.
- The upsert replaces a game's alias set when the record carries aliases and
  leaves it alone when the record carries none. This is the same rule
  `_write_external_ids` follows, for the same reason: a source that does not
  publish aliases is not saying the game has none.
- An alias equal to the title after normalization is dropped.
- `seed_games.json` gains a handful of aliases (for example "GTA V" and
  "BotW") so local development exercises the path.

**Filter**

Let `nq` be the normalized query, `cq` its compact form and `tokens` its words.
A game matches when any of these holds for its title **or** any of its aliases:

1. **All words present, any order.** Every token is a substring of
   `search_key`, written as an `AND` of `LIKE '%token%'` conditions with
   wildcards escaped as today.
2. **Compact substring.** `search_compact LIKE '%cq%'`. This catches
   "spiderman" and "spider man", or "halflife" and "half life".
3. **Fuzzy.** `nq <% search_key` (`word_similarity` above
   `pg_trgm.word_similarity_threshold`). The threshold is set with `SET LOCAL`
   inside the request's transaction, so it cannot leak through the connection
   pool. It starts at `FUZZY_THRESHOLD = 0.5` and is tuned against the
   relevance suite.

Each condition can use a trigram index, so the planner combines them with a
`BitmapOr` rather than scanning `games`. Alias matches are found through an
`EXISTS` over `game_aliases` in the same `OR`.

**Short queries.** When `nq` is 1 or 2 characters, trigram indexes cannot
help. Only a prefix match on the title runs: `search_key LIKE 'nq%'`, served
by the `text_pattern_ops` btree. Fuzzy matching and alias matching are
skipped. Typing "ha" lists "Hades" and "Halo".

**Empty after normalization.** A query such as "!!!" returns an empty page
with status 200. The raw input passed `SearchQuery` validation, so a 422
would be wrong.

**Ranking**

```
text       = greatest(title_text, ALIAS_WEIGHT × best_alias_text)
title_text = 0.7 × word_similarity(nq, search_key) + 0.3 × similarity(nq, search_key)
             + EXACT_BONUS if search_key = nq
popularity = least(1, ln(1 + coalesce(igdb_rating_count, 0) + REVIEW_WEIGHT × rating_count)
                      / ln(1 + POPULARITY_CEILING))
score      = text + POPULARITY_WEIGHT × popularity
```

These are the starting constants, all named in `services/search.py`:
`ALIAS_WEIGHT = 0.95`, `EXACT_BONUS = 1.0`, `REVIEW_WEIGHT = 5`,
`POPULARITY_WEIGHT = 0.25`, and `POPULARITY_CEILING = 5000`, which is roughly
where IGDB's most-rated games sit. With `word_similarity` in the text term,
"mario" scores every Mario title equally, so popularity decides among them,
and the `similarity` share breaks remaining ties toward shorter, closer
titles. Typing a full title always puts it first. `best_alias_text` comes from
a lateral subquery over the game's aliases. In the short-query branch, `text`
is `similarity` alone.

**Paging.** Keyset paging continues on `(score, id)` through the existing
`fetch_keyset_page` and `KeysetSort`. `rating_count` changes with review
writes, so a game's score can move between page 1 and page 2. This is accepted
for search, where the tail is low-value and the UI already says "keep typing
to narrow".

**Contract.** The endpoint stays `GET /search/games`, returning
`CursorPage[GameSummary]`. The rate limit, `limit` bounds and the cursor
format are unchanged.

### 3. User search

**Text matching**

- `users.username_key`, `users.username_compact`, `users.display_name_key`
  and `users.display_name_compact` are generated with `search_normalize`, and
  each gets a GIN trigram index. Every filter branch must be indexed, because
  one unindexed branch turns the `BitmapOr` into a sequential scan.
  `username_key` also gets a `text_pattern_ops` btree for short queries.
  `ix_users_username_trgm` and `ix_users_display_name_trgm` are dropped.
- The three-condition filter, the short-query prefix branch and the
  empty-after-normalize rule apply as for games, over the handle and the
  display name.
- **Query cleanup.** Exactly one leading `@` is stripped before
  normalization. A query that is only `@` is empty after normalization and
  returns an empty page.
- `text = greatest(handle_text, DISPLAY_NAME_WEIGHT × display_name_text)`,
  with `DISPLAY_NAME_WEIGHT` kept at 0.9, plus `EXACT_BONUS` when
  `username_key = nq`.

**Social boost** (signed-in viewers only), added to `text`:

| Relationship to viewer | Boost |
| --- | --- |
| Viewer follows them (`accepted`) | `FOLLOWING_BOOST = 0.30` |
| They follow the viewer (`accepted`) | `FOLLOWER_BOOST = 0.20` |
| Followed by people the viewer follows | `FOF_BOOST × min(paths, 3) / 3`, with `FOF_BOOST = 0.10` |

- The boosts add up, so a mutual follow gets +0.50.
- `pending` follows count for nothing, consistent with the rule that a
  pending request unlocks nothing.
- The viewer's own row gets no boost.
- Signed-out viewers get text ranking only.

**Privacy argument for friend-of-friend.** Paths only run through accounts
the viewer follows with an accepted follow. SPEC §6.7 already lets an approved
follower see that account's following list, and a public account's list is
public. The boost therefore reveals only ordering information the viewer could
already read from profiles they can see. A private account the viewer does
not follow never contributes a path.

**Implementation.** One CTE holds the viewer's accepted followees and
followers. A grouped CTE over `follows` counts friend-of-friend paths and is
served by `ix_follows_follower_id_status`. The candidates `LEFT JOIN` both
CTEs, so signed-in and signed-out queries share one statement shape. The
boost is part of the keyset sort expression, which keeps paging consistent.

**Unchanged:** `is_active` filtering, private accounts returned as shells
with `review_count` null through `_visible_review_counts`, the email never
being exposed, and the `UserSearchResult` shape. A "followed by X" reason
field is deliberately left out. It would widen the contract and need its own
privacy review.

### 4. Shared client search (`packages/core/src/search.ts`)

- **`useSearch(kind, term, { limit?, debounceMs = 250, enabled = true })`**
  returns `{ items, searching, error, hasMore, loadMore, loadingMore }`.
  - The item type follows `kind` through an overload or a generic map:
    `GameSummary` for `"games"` and `UserSearchResult` for `"users"`, both
    from `@sidequestd/api-types`. No shapes are redeclared.
  - Whitespace-only input clears results and makes no request.
  - Requests are debounced. An in-flight request is ignored once `term`,
    `kind` or `limit` changes.
  - `loadMore` keeps today's guard (a ref holding the current term and kind,
    compared after the await) so a stale page never appends.
  - It uses `useAuth().authedRequest`.
- **`searchQuery(kind, term, cursor?, limit?)`** gains an optional `limit`.
  The pickers stop fetching a full page and slicing it on the client.
- **Shared copy:** the empty-state strings ("Search the catalog by title.",
  "Search by handle or display name." and the no-match line) move next to the
  hook.
- **Callers:** web `search/page.tsx`, mobile `(tabs)/search.tsx`, web
  `favorite-games.tsx`, web `reviews/new/page.tsx` and mobile
  `game-picker.tsx`. Each keeps its own markup, disabled-row state and gated
  `review_count` presentation. The `game-picker.tsx` header comment about the
  two web pickers drifting is updated.

## Rollout

- **One Alembic revision**, chained after the current head:
  1. `CREATE EXTENSION IF NOT EXISTS unaccent`.
  2. Create `search_normalize`.
  3. Add the generated columns. This rewrites `games` and `users` under an
     `ACCESS EXCLUSIVE` lock, which takes seconds at about 350k games.
  4. Create `game_aliases`.
  5. Create the new indexes with `CREATE INDEX CONCURRENTLY` inside
     `op.get_context().autocommit_block()`.
  6. Drop the three old trigram indexes.

  The downgrade reverses these steps but leaves the extension in place.
- **Verify before deploying:** that the production managed Postgres 17 allows
  `CREATE EXTENSION unaccent`. It ships with Postgres's standard extensions, as
  `pg_trgm` does, which is already in use.
- **Aliases are empty until the next IGDB sync**, either the Sunday
  `catalog-sync.yml` or a manual `npm run api:seed -- --igdb --all`. Search
  works without aliases; only abbreviation matching waits on the sync.
- Add a note to `deployment.md` about the brief table lock and the
  extension requirement.

## Testing

- **`tests/test_search_relevance.py` (new):** a known-query suite against a
  small catalog of deliberate near-misses: popular and obscure Mario titles,
  "Spider-Man", "Pokémon", and "The Witcher 3: Wild Hunt" with a "TW3" alias.
  It asserts that the expected game ranks first, or in the top 3 where that is
  the honest claim. It covers accents, punctuation, word order, typos,
  aliases, exact-title-first, popularity ordering, short-query prefix
  matching, and the empty-after-normalize 200. The weight constants are tuned
  against this suite.
- **`tests/test_search.py`:** every existing privacy and shape test passes
  unchanged. New tests cover:
  - the following, follower and mutual boost ordering,
  - friend-of-friend counting only accepted paths,
  - no friend-of-friend paths through a private account the viewer does not
    follow,
  - pending follows giving no boost,
  - `@` stripping and the lone-`@` empty page,
  - an exact handle beating a closer-scoring display name,
  - signed-out ranking being text-only.
- **Import tests:** aliases are parsed from an IGDB payload, replaced when
  present, preserved when absent, and an alias equal to the title is dropped.
- **Migration:** `alembic upgrade head` and `alembic downgrade -1` both run
  cleanly against the test database.
- **`packages/core/src/search.test.tsx` (new):** with vitest fake timers,
  covers the debounce, ignoring stale responses after a term change, the
  load-more stale guard, whitespace-only input, `limit` passthrough, and
  errors surfacing.
- **Clients:** `npm run web:test`, including the existing
  `search/page.test.tsx` and `reviews/new/page.test.tsx`; then
  `cd apps/mobile && npm run typecheck && npm run lint`; and `npm run lint`.

## Knowledge-bundle upkeep when this lands

- `domains/discovery.md`: rewrite the Search section.
- `models/catalog.md`: the new `games` columns and indexes, and
  `game_aliases`.
- `models/users-and-auth.md`: the new `users` columns and indexes.
- `models/index.md`: add the revision to the migration chain and link
  `game_aliases`.
- `architecture/shared-packages.md`: `useSearch` and the new `searchQuery`
  argument.
- `architecture/deployment.md`: the lock and extension note.
- `product/spec.md` §6.6 "As built" note and `product/roadmap.md`.
- `log.md`: the entry, with the revision id. Mark this record's status as
  built.

No API contract changes, so `models/api-contract.md` and `npm run gen:types`
are unaffected.
