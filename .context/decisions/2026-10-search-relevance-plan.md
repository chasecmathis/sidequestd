---
type: decision_log
title: "Search Relevance — Implementation Plan (2026-10)"
description: "Task-by-task implementation plan for the search relevance design: migration and models, game search, alias import, user search, the shared client hook, client migration and docs."
tags: [decisions, search, plan, pg_trgm, unaccent, core]
timestamp: 2026-10-04T03:26:35Z
resource: apps/api/app/services/search.py
---

# Search Relevance Implementation Plan

> **Executed 2026-10-04.** Every task is complete. The rulings made during
> execution are listed in the change log entry for this date.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Game search that tolerates typos, word order, accents, punctuation
and abbreviations and ranks popular games first; user search that ranks by
the follow graph; one shared client search hook.

**Architecture:** Postgres-native. An `IMMUTABLE` `search_normalize()` SQL
function backs generated `*_key` and `*_compact` columns on `games`,
`game_aliases` and `users`, each with a trigram GIN index. The search service
normalizes the query with the same function, then filters with three indexed
conditions OR'd together: all words present, compact substring, and fuzzy
`<%`. It ranks with a blended score. Clients share `useSearch` from
`packages/core`.

**Tech stack:** FastAPI, SQLAlchemy 2 (async), Alembic, Postgres 17 with
`pg_trgm` and `unaccent`, pytest; React 19, vitest and Testing Library;
Next.js; Expo.

**Spec:** [2026-10-search-relevance.md](2026-10-search-relevance.md)

## Global constraints

- No API contract change: `GET /search/games` returns `CursorPage[GameSummary]`
  and `GET /search/users` returns `CursorPage[UserSearchResult]`. No `gen:types`.
- Every filter branch must be index-served. A query whose compact form is under
  3 characters takes the prefix-only branch. Words under 3 characters are left
  out of the all-words condition.
- Privacy: `review_count` stays gated through `content_is_visible_to`, and
  friend-of-friend paths run only through the viewer's **accepted** follows.
- The constants are the spec's starting values: `FUZZY_THRESHOLD = 0.5`,
  `WORD_SIMILARITY_SHARE = 0.7`, `EXACT_MATCH_BONUS = 1.0`,
  `ALIAS_WEIGHT = 0.95`, `DISPLAY_NAME_WEIGHT = 0.9`,
  `POPULARITY_WEIGHT = 0.25`, `REVIEW_WEIGHT = 5`,
  `POPULARITY_CEILING = 5000`, `FOLLOWING_BOOST = 0.30`,
  `FOLLOWER_BOOST = 0.20`, `FRIEND_OF_FRIEND_BOOST = 0.10`,
  `FRIEND_OF_FRIEND_PATH_CAP = 3`.
- Services raise `ServiceError` subclasses, never `HTTPException`. mypy strict.
  Comments explain *why*.
- No markdown outside `.context/`.

## Findings from implementation research (2026-10-04)

These were measured against a 350k-row synthetic catalog on the local Postgres
17 and refine the spec:

- **Aliases are matched through a `UNION ALL` of candidates, not `OR EXISTS`.**
  `OR EXISTS` stops Postgres from combining the index scans and forces a
  sequential scan: 1.5 s, against 22 ms for the union. Scores are computed
  inside the candidate branches and reduced with `max()` per game, which took
  a broad query (44k matches) from 840 ms to 210 ms. A narrow query such as
  "gta v" runs in 0.1 ms.
- **Words under 3 characters stay out of the all-words filter**, because a
  pattern with no trigram makes the GIN index return every row. A query is
  "short" when its *compact* form is under 3 characters, for the same reason.
- **Patterns are rendered as SQL literals (`literal_execute`)**, so the planner
  can always see them. A bound parameter hides the pattern whenever Postgres
  switches a prepared statement to its generic plan.
- **A leading `@` needs no code.** `search_normalize('@ripley')` is `ripley`,
  and a lone `@` normalizes to the empty string, which returns an empty page.
- **`[^[:alnum:]]` rather than `[^a-z0-9]`**, so CJK and other non-Latin names
  keep their letters instead of normalizing to nothing.
- **The exact-match bonus applies to every key**: title, alias, handle and
  display name. That is simpler than handle-only and gives the same ordering
  in every case the spec names.

## Review focus

The five input classes most likely to bite a real user that the spec does not
call out. Each has a test in the owning task:

1. **Non-Latin names** (for example "山田 太郎") stay searchable, both by prefix
   and in full. *Task 4.*
2. **Queries made only of short words** ("ff 7") do not error and still reach
   the alias. *Task 2.*
3. **Handle punctuation** ("ripley_88" found by "ripley88" and by "ripley 88").
   *Task 4.*
4. **Paging a blended score**, including the alias union, neither repeats nor
   skips a row. *Task 2.*
5. **A game renamed on re-import** is found by its new title and not its old
   one; the generated column must recompute. *Task 3.*

---

## File map

| File | Change |
| --- | --- |
| `apps/api/migrations/versions/5d2e8b4c9a17_search_relevance.py` | new: extension, function, columns, `game_aliases`, indexes |
| `apps/api/app/models/search_keys.py` | new: `search_key()` / `search_compact()` `Computed` factories |
| `apps/api/app/models/game.py` | `Game` key columns and indexes; new `GameAlias` |
| `apps/api/app/models/user.py` | `User` key columns and indexes |
| `apps/api/app/models/__init__.py` | export `GameAlias` |
| `apps/api/app/services/search.py` | rewritten matching and ranking |
| `apps/api/app/services/games_import.py` | `aliases` on `GameRecord`, `_write_aliases`, `IGDB_FIELDS` |
| `apps/api/app/data/seed_games.json` | a few aliases |
| `apps/api/tests/test_search_relevance.py` | new: the known-query suite |
| `apps/api/tests/test_search.py` | paging test adjusted; user and social tests |
| `apps/api/tests/test_games_import.py` | alias import tests |
| `packages/core/src/search.ts` (+ `.test.tsx`) | new: `useSearch`, prompts |
| `packages/core/src/catalog.ts` (+ test), `index.ts` | `searchQuery(…, limit?)`; exports |
| `apps/web/src/app/search/page.tsx`, `apps/web/src/app/reviews/new/page.tsx`, `apps/web/src/components/favorite-games.tsx` | use `useSearch` |
| `apps/mobile/app/(tabs)/search.tsx`, `apps/mobile/src/components/game-picker.tsx` | use `useSearch` |
| `.context/**` | upkeep (Task 8) |

---

### Task 1: Migration and models

**Files:**
- Create: `apps/api/migrations/versions/5d2e8b4c9a17_search_relevance.py`
- Create: `apps/api/app/models/search_keys.py`
- Modify: `apps/api/app/models/game.py`, `apps/api/app/models/user.py`,
  `apps/api/app/models/__init__.py`

**Interfaces:**
- Produces: the SQL function `public.search_normalize(text) -> text`.
- Produces: the columns `Game.search_key`, `Game.search_compact`,
  `User.username_key`, `User.username_compact`, `User.display_name_key`,
  `User.display_name_compact`, all deferred.
- Produces: the model `GameAlias(id, game_id, alias, search_key, search_compact)`
  with unique `(game_id, search_key)`.

- [ ] **Step 1: Write the migration.** The `Computed` expressions call
  `public.search_normalize(<col>)` and
  `replace(public.search_normalize(<col>), ' ', '')`. Create the extension and
  the function (escape `:` as `\:` inside `sa.text`), add the six generated
  columns, and create `game_aliases` with its unique constraint and two GIN
  indexes. Create the nine indexes on `games` and `users` with
  `postgresql_concurrently=True` inside
  `op.get_context().autocommit_block()`, then drop `ix_games_title_trgm`,
  `ix_users_username_trgm` and `ix_users_display_name_trgm`. The downgrade
  recreates the three old indexes, drops `game_aliases` and the six columns
  (their indexes go with them), and drops the function. `unaccent` stays
  installed, as `pg_trgm` does in `de134620f0fc`.

  ```sql
  CREATE FUNCTION public.search_normalize(value text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$
      SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(public.unaccent('public.unaccent'::regdictionary, value)),
          '[^[:alnum:]]+', ' ', 'g'))
  $$
  ```

  The indexes on populated tables:

  | Name | Table | Column | Opclass |
  | --- | --- | --- | --- |
  | `ix_games_search_key_trgm` | games | search_key | gin_trgm_ops (GIN) |
  | `ix_games_search_compact_trgm` | games | search_compact | gin_trgm_ops (GIN) |
  | `ix_games_search_key_prefix` | games | search_key | text_pattern_ops (btree) |
  | `ix_users_username_key_trgm` | users | username_key | gin_trgm_ops |
  | `ix_users_username_compact_trgm` | users | username_compact | gin_trgm_ops |
  | `ix_users_username_key_prefix` | users | username_key | text_pattern_ops |
  | `ix_users_display_name_key_trgm` | users | display_name_key | gin_trgm_ops |
  | `ix_users_display_name_compact_trgm` | users | display_name_compact | gin_trgm_ops |
  | `ix_users_display_name_key_prefix` | users | display_name_key | text_pattern_ops |

- [ ] **Step 2: Add the `search_keys.py` factories and model columns**, mirroring
  the migration. The columns are `deferred=True` because no response renders
  them. Replace the old `__table_args__` trigram indexes with the new ones, add
  the `GameAlias` class after `GameExternalId`, and export it.

  ```python
  def search_key(column: str) -> sa.Computed:
      return sa.Computed(f"public.search_normalize({column})", persisted=True)

  def search_compact(column: str) -> sa.Computed:
      return sa.Computed(f"replace(public.search_normalize({column}), ' ', '')", persisted=True)
  ```

- [ ] **Step 3: Run the suite's migration and the existing search tests.**
  Run: `cd apps/api && uv run pytest tests/test_search.py -q`
  Expected: the session fixture rebuilds the schema through `upgrade head`.
  Every test passes except `test_search_results_page`, which still uses the
  old ILIKE service and may pass or fail; Task 2 owns it.

- [ ] **Step 4: Round-trip the migration.**
  Run: `cd apps/api && DATABASE_URL=postgresql+asyncpg://sidequestd:sidequestd@localhost:5432/sidequestd_test uv run alembic downgrade -1 && … uv run alembic upgrade head`
  Expected: both succeed.

- [ ] **Step 5: Commit** `feat(api): normalized search keys and game_aliases`.

### Task 2: Game search

**Files:**
- Modify: `apps/api/app/services/search.py`
- Create: `apps/api/tests/test_search_relevance.py`
- Modify: `apps/api/tests/test_search.py` (`test_search_results_page`)

**Interfaces:**
- Consumes: the Task 1 columns and `GameAlias`.
- Produces: `NormalizedQuery(key)` with `.compact`, `.is_empty`, `.is_short`
  and `.long_words`; `_normalize(db, raw) -> NormalizedQuery`;
  `_matches(key, compact, q)`; `_text_score(key, q)`. The signature
  `search_games(db, query, *, cursor, limit) -> KeysetPage[Game]` is unchanged.

- [ ] **Step 1: Write `tests/test_search_relevance.py`.** Build a hand-made
  catalog of near-misses (`CATALOG`: Super Mario Odyssey 3000 /
  Mario's Super Picross 40, Marvel's Spider-Man 2, Pokémon Scarlet, The Witcher
  3 with aliases "TW3" and "Witcher 3", Witcheye 10, Grand Theft Auto V with
  "GTA V", Final Fantasy VII with "FF7", Elden Ring, Half-Life 2, Hades 3500,
  Hades II 900, Halo Infinite, Celeste 10, Celeste Classic 4000). Then write:

  ```python
  @pytest.mark.parametrize(("query", "expected"), [
      pytest.param("pokemon", "Pokémon Scarlet", id="accents"),
      pytest.param("spiderman", "Marvel's Spider-Man 2", id="punctuation-joined"),
      pytest.param("spider man", "Marvel's Spider-Man 2", id="punctuation-spaced"),
      pytest.param("halflife", "Half-Life 2", id="hyphen-joined"),
      pytest.param("witcher wild hunt", "The Witcher 3: Wild Hunt", id="non-contiguous"),
      pytest.param("wild hunt witcher", "The Witcher 3: Wild Hunt", id="word-order"),
      pytest.param("eldin ring", "Elden Ring", id="typo"),
      pytest.param("witchr", "The Witcher 3: Wild Hunt", id="typo-popular-first"),
      pytest.param("gta v", "Grand Theft Auto V", id="alias"),
      pytest.param("tw3", "The Witcher 3: Wild Hunt", id="alias-abbreviation"),
      pytest.param("ff 7", "Final Fantasy VII", id="alias-short-words"),
      pytest.param("mario", "Super Mario Odyssey", id="popularity"),
      pytest.param("celeste", "Celeste", id="exact-beats-popularity"),
      pytest.param("hades", "Hades", id="closer-title"),
  ])
  async def test_the_game_meant_ranks_first(client, query, expected): ...
  ```

  Also test: a game matched by its title and an alias appears once;
  "qzxwv" returns nothing; "ha" returns exactly
  {Hades, Hades II, Half-Life 2, Halo Infinite}; "hz" returns nothing (a short
  query is not fuzzy); "!!!", "@" and "--" return a 200 empty page; and paging
  "witcher" and "ha" with `limit=1` gives the same list as one `limit=50` page.

- [ ] **Step 2: Run it to see it fail.**
  Run: `uv run pytest tests/test_search_relevance.py -q`
  Expected: most cases fail (no accent, alias or typo support).

- [ ] **Step 3: Rewrite `search_games`**:
  1. `_normalize` makes one round trip:
     `SELECT search_normalize(:q), set_config('pg_trgm.word_similarity_threshold', '0.5', true)`.
  2. An empty normalized query returns an empty page.
  3. `_matches` is either a prefix `LIKE` (short query) or
     `OR(compact LIKE, q <% key, AND(key LIKE word…))` with `_inline` literals.
  4. `title_hits UNION ALL alias_hits` (aliases only when the query is not
     short), then `max(text)` per game.
  5. `score = text + POPULARITY_WEIGHT * least(1, ln(1 + coalesce(igdb_rating_count, 0) + REVIEW_WEIGHT * rating_count) / ln(1 + POPULARITY_CEILING))`.
  6. Page through `fetch_keyset_page` with `KeysetSort(expression=score, …)`.

- [ ] **Step 4: Change `test_search_results_page`** to `q="re", limit=1`, the
  seed catalog's two "re…" titles. The old `q="a"` relied on substring matching
  for a 1-character query, which is now a prefix match by design.

- [ ] **Step 5: Run the search tests.**
  Run: `uv run pytest tests/test_search.py tests/test_search_relevance.py -q`
  Expected: PASS.

- [ ] **Step 6: Commit** `feat(api): typo-, accent- and alias-tolerant game search`.

### Task 3: Alias import

**Files:**
- Modify: `apps/api/app/services/games_import.py`, `apps/api/app/data/seed_games.json`
- Test: `apps/api/tests/test_games_import.py`

**Interfaces:**
- Produces: `GameRecord.aliases: tuple[str, ...] = ()`;
  `ImportResult.aliases_written: int`;
  `_write_aliases(db, owned: Sequence[tuple[uuid.UUID, tuple[str, ...]]]) -> int`.

- [ ] **Step 1: Write failing tests:**
  - `_record_from_igdb` maps `alternative_names[].name` to `aliases`,
    skipping entries without a name;
  - a game with no `alternative_names` has `()`;
  - `"alternative_names.name" in IGDB_FIELDS`;
  - an import writes aliases and counts them;
  - a re-import with aliases replaces the set;
  - a re-import without aliases leaves the set alone;
  - case and accent duplicates collapse to one;
  - an alias equal to the title after normalization, or one that normalizes
    to nothing, is dropped;
  - a game renamed on re-import is found by its new title and not its old one
    (Review focus 5).

- [ ] **Step 2: Run them to see them fail.**
  Run: `uv run pytest tests/test_games_import.py -q -k alias or renamed`

- [ ] **Step 3: Implement.** Add `aliases` to both record builders and to
  `IGDB_FIELDS`. In `upsert_games`, collect `(game, aliases)` and flush once
  when either store ids or aliases need game ids. `_write_aliases` works as
  follows:
  1. Delete the existing aliases of the games in the batch.
  2. `INSERT … ON CONFLICT (game_id, search_key) DO NOTHING`.
  3. Run `DELETE … USING games` for aliases whose `search_key` is `''` or
     equals the game's `search_key`.
  4. Return the count that remains.

  Add `aliases_written` to `summary_line` and `merge`. Seed aliases:
  GTA V gets ["GTA V", "GTA 5"], Zelda BotW gets ["BotW"], and The Witcher 3
  gets ["TW3"].

- [ ] **Step 4: Run the tests.** Run: `uv run pytest tests/test_games_import.py -q`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): import IGDB alternative names as search aliases`.

### Task 4: User search

**Files:**
- Modify: `apps/api/app/services/search.py`
- Test: `apps/api/tests/test_search.py`

**Interfaces:**
- Consumes: `_normalize`, `_matches` and `_text_score` from Task 2;
  `Follow` and `FollowStatus`.
- Produces: `_social_boost(viewer_id) -> ColumnElement[float]`. The signature
  `search_users(db, query, *, viewer_id, cursor, limit) -> KeysetPage[UserHit]`
  is unchanged.

- [ ] **Step 1: Write failing tests**, using the `auth_headers` fixture:
  - "@ripley" finds ripley, and "@" returns a 200 empty page;
  - "ripley88", "ripley 88" and "ripley_88" all find `ripley_88`
    (Review focus 3);
  - "zoe" finds display name "Zoë Washburne";
  - "山田" and "山田太郎" find display name "山田 太郎" (Review focus 1);
  - the ordering mutual > following > follower > friend-of-friend > stranger
    for kane_e … kane_a;
  - pending follows give the same order as an anonymous search;
  - a private account the viewer does not follow gives no friend-of-friend
    path (same order as anonymous);
  - the viewer's own row gets no boost from a path back to itself (same order
    as anonymous).

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement.**
  - `text = greatest(_text_score(username_key), coalesce(_text_score(display_name_key), 0) * DISPLAY_NAME_WEIGHT)`.
  - `candidates = select(User.id, text + _social_boost(viewer_id))`, filtered by
    `is_active` and either `_matches` branch.
  - Page `select(User, candidates.c.score)` on `candidates.c.score`.
  - `_social_boost` adds `FOLLOWING_BOOST` (an EXISTS on the viewer's accepted
    follow), `FOLLOWER_BOOST` (an EXISTS the other way), and
    `least(paths, 3) * (0.10 / 3)`, where `paths` is a correlated count over
    `their_follows JOIN viewer_follows`, both accepted. The whole thing is
    wrapped in `CASE WHEN users.id = viewer THEN 0`.

- [ ] **Step 4: Run all search tests.** Expected: PASS, including every
  privacy test unchanged.

- [ ] **Step 5: Commit** `feat(api): follow-graph-aware user search`.

### Task 5: `useSearch` in `packages/core`

**Files:**
- Create: `packages/core/src/search.ts`, `packages/core/src/search.test.tsx`
- Modify: `packages/core/src/catalog.ts`, `packages/core/src/catalog.test.ts`,
  `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `searchQuery(kind, term, cursor?, limit?)`;
  - `SEARCH_DEBOUNCE_MS = 250`;
  - `type SearchKind = "games" | "users"`;
  - `type SearchResult<K>` (`GameSummary` | `UserSearchResult`);
  - `interface SearchOptions { limit?; debounceMs?; enabled? }`;
  - `interface SearchState<T> { items; searching; error; hasMore; loadingMore; loadMore }`;
  - `useSearch<K>(kind, term, options?) => SearchState<SearchResult<K>>`;
  - `SEARCH_PROMPTS: Record<SearchKind, string>`;
  - `noSearchMatches(kind, term): string`.

- [ ] **Step 1: Write failing tests** in `search.test.tsx` (mock `./auth`):
  - a whitespace term sends no request;
  - typing m → ma → mar sends one request for `q=mar`;
  - `limit` is sent;
  - a response for a superseded term is ignored;
  - `loadMore` appends and retires the cursor;
  - `loadMore` drops a page that lands after the term changed;
  - a failure sets `error` and clears items;
  - `enabled: false` behaves like an empty term;
  - `"users"` hits `/search/users`;
  - `noSearchMatches` trims.

  In `catalog.test.ts`, test that `searchQuery` carries `limit`.

- [ ] **Step 2: Run them to see them fail.** Run: `npm run core:test`

- [ ] **Step 3: Implement** the hook: a debounced effect keyed on
  `[authedRequest, kind, query, limit, debounceMs]`, with a `latest` ref for
  the load-more stale guard. Export it from `index.ts`.

- [ ] **Step 4: Run the tests.** Run: `npm run core:test && npm run typecheck --workspace @sidequestd/core`
  Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): shared useSearch hook`.

### Task 6: Web callers

**Files:** `apps/web/src/app/search/page.tsx`,
`apps/web/src/app/reviews/new/page.tsx`,
`apps/web/src/components/favorite-games.tsx`

- [ ] **Step 1: Search page.** Use two hooks, `useSearch("games", term, { enabled: tab === "games" })`
  and the same for `"users"`, with `active` picked by tab. Take the prompts from
  `SEARCH_PROMPTS` and the no-match copy from `noSearchMatches`. The no-match
  empty state is hidden while an error is showing. Remove the local
  debounce, stale guard and cursor state.
- [ ] **Step 2: Review-compose picker.** `useSearch("games", term, { limit: 6 })`.
- [ ] **Step 3: Favorites picker.** `useSearch("games", term, { enabled: open })`.
  Keep the clear-on-close effect for `term`.
- [ ] **Step 4: Run the web tests and lint.** Run: `npm run web:test && npm run web:lint`
  Expected: PASS, with the existing `search/page.test.tsx` unchanged.
- [ ] **Step 5: Commit** `refactor(web): search surfaces use useSearch`.

### Task 7: Mobile callers

**Files:** `apps/mobile/app/(tabs)/search.tsx`, `apps/mobile/src/components/game-picker.tsx`

- [ ] **Step 1:** Make the same change as Task 6 Step 1 on the mobile Search
  screen.
- [ ] **Step 2:** `GamePicker` uses `useSearch("games", term, { limit })`.
  Update its header comment, since the web pickers no longer drift.
- [ ] **Step 3: Typecheck and lint.** Run: `cd apps/mobile && npm run typecheck && npm run lint`
  Expected: PASS.
- [ ] **Step 4: Commit** `refactor(mobile): search surfaces use useSearch`.

### Task 8: Knowledge bundle and full verification

- [ ] **Step 1: Update docs.**
  - `domains/discovery.md`: the Search section.
  - `models/catalog.md`: the new columns and indexes, and `game_aliases`.
  - `models/users-and-auth.md`: the new columns and indexes.
  - `models/index.md`: the chain, plus the `game_aliases` link.
  - `architecture/shared-packages.md`: `useSearch`.
  - `architecture/deployment.md` §3 "Migrate and start": the lock and the
    extension.
  - `product/spec.md` §6.6 "As built" and `product/roadmap.md`.
  - The spec record: mark it built and list the deviations.
  - `log.md`.

  Bump every modified file's `timestamp`.
- [ ] **Step 2: Run the full verification.**
  Run: `npm run api:test && npm run api:lint && npm run core:test && npm run web:test && npm run lint && (cd apps/mobile && npm run typecheck && npm run lint)`
  Expected: all pass.
- [ ] **Step 3: Commit** `docs(context): search relevance`.
