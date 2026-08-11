# Sidequestd

Letterboxd for video games with an Instagram-style social feed. See
[`SPEC.md`](./SPEC.md) for the full product requirements — it is the source of
truth for everything below.

> **Status: the MVP surface is complete.** Authentication and onboarding
> (SPEC §6.1), the games catalog with browse/Discover and search (SPEC §6.5,
> §6.6), user profiles with favorites and stats (SPEC §6.2, §6.8), reviews with
> the media pipeline (SPEC §6.3), the social graph with follow requests and
> private-account approval (SPEC §6.7), likes and comments (SPEC §6.10), the Home
> feed (SPEC §6.4), the four backlog lists with their activity events blended
> into that feed (SPEC §6.9, §6.11), in-app notifications (SPEC §6.12), and
> personalised recommendations on Discover and in the feed blend (SPEC §6.4,
> §6.5) are implemented and verified end to end. The complete SPEC §7 schema
> exists as a migration; DMs (SPEC §6.14) and the settings screen (SPEC §6.13)
> are what is left.

---

## What's here

```
sidequestd/
├── apps/
│   ├── api/           FastAPI + PostgreSQL, shared by both clients
│   ├── web/           Next.js 15 (App Router) + React 19 + TypeScript
│   └── mobile/        Expo / React Native — scaffold only
├── packages/
│   └── api-types/     TypeScript types generated from the API's OpenAPI schema
├── infra/
│   ├── docker-compose.yml       dev dependencies: Postgres 17, MinIO, Mailpit
│   └── docker-compose.prod.yml  the two production images + Postgres
├── DEPLOY.md          production runbook
├── fly.web.toml       Fly.io app config for the web client
└── package.json       npm workspaces root (apps/web + packages/*)
```

Each app carries its own production `Dockerfile`; see [`DEPLOY.md`](./DEPLOY.md).
A merge to `main` builds and deploys both to Fly.io automatically — DEPLOY.md §7.
(`fly.web.toml` is at the root, and the API's is at `apps/api/fly.toml`, because
each one has to sit in its image's build context.)

`apps/mobile` is deliberately **outside** the npm workspace — Metro resolves
modules from the package directory rather than a hoisted root, and workspace
hoisting produces duplicate React copies. It consumes `@sidequestd/api-types`
through a `file:` dependency and is installed separately.

### Stack choices

| Layer      | Choice                                                                |
| ---------- | --------------------------------------------------------------------- |
| API        | FastAPI, Python 3.12, `uv`                                            |
| ORM        | SQLAlchemy 2.0 (async, `asyncpg`) + Pydantic v2 schemas               |
| Migrations | Alembic                                                               |
| Auth       | argon2id passwords, JWT access tokens, rotating opaque refresh tokens |
| Web        | Next.js 15, React 19, Tailwind CSS v4, Vitest                         |
| Mobile     | Expo SDK 54, expo-router                                              |
| Storage    | MinIO (S3-compatible) — avatars now, review media next                |
| Email      | Mailpit in dev; anything SMTP in production                           |

---

## Prerequisites

- **Docker** (Postgres, MinIO, Mailpit)
- **[uv](https://docs.astral.sh/uv/)** — `brew install uv`
- **Node 20+**

## Run it locally

```bash
# 1. Start the infrastructure
npm run infra:up

# 2. Install and migrate the API
npm run api:install
npm run api:migrate

# 3. Load the games catalog (offline seed fixture — no IGDB account needed)
npm run api:seed

# 4. Install the JS workspaces
npm install

# 5. In one terminal — the API on :8000
npm run api:dev

# 6. In another — the web client on :3000
npm run web:dev
```

Then open <http://localhost:3000>, create an account, and hit **Write a review**:
pick a game, drag the rating to a half-star, add a photo or a short clip, and
post. The uploads land in MinIO and turn from `PENDING` to `READY` a moment later
— the detail page polls until they do. **Profile** is where the reviews grid,
favorites, avatar and privacy live.

| Service         | URL                        |
| --------------- | -------------------------- |
| Web client      | http://localhost:3000      |
| API             | http://localhost:8000      |
| API docs        | http://localhost:8000/docs |
| Mailpit (email) | http://localhost:8025      |
| MinIO console   | http://localhost:9001      |

Password-reset emails never leave your machine — read them in Mailpit and click
the link, which lands on `/reset-password?token=…` in the web client.

### Mobile

```bash
cd apps/mobile
npm install      # separate install, see above
npm run start
```

---

## Tests and checks

```bash
npm test          # API (pytest) + web (vitest)
npm run lint      # ruff + mypy + eslint + prettier
npm run format    # autofix everything

npm run api:test  # just the API — needs the Postgres container running
npm run web:test  # just the web client
```

The API suite runs against a **real Postgres** database (`sidequestd_test`,
created by `infra/postgres/init`), applying the Alembic migration and rolling
each test back in a transaction. That means constraints, enum types and the
migration itself are all exercised rather than approximated by SQLite.

## Loading the games catalog

The catalog mirrors a third-party games database (SPEC §2) and is cached locally,
so no request ever waits on a third party. Two sources, one importer:

```bash
npm run api:seed                       # the bundled fixture — 24 games, offline
npm run api:seed -- --file mine.json   # your own fixture, same shape
npm run api:seed -- --igdb --limit 200 # one page of the best-rated games
npm run api:seed -- --igdb --all       # the whole IGDB catalog
```

The seed path is the default on purpose: a fresh checkout has a browsable catalog
with no credentials and no network. `--igdb` reads `IGDB_CLIENT_ID` and
`IGDB_CLIENT_SECRET`; without them it says so and points you back at the fixture
rather than importing nothing quietly.

Imports are **idempotent** — they key on `external_id`, so re-running updates rows
in place rather than duplicating the catalog, and a later live IGDB sync updates
any seeded row whose id it matches.

The fixture is **development data**, not a mirror of IGDB. Its 24 entries are real
games with real metadata, but the ids are best-effort and only the 16 cover URLs
that were checked against the right game are populated — the rest are `null` and
render as a "no cover art" card. Treat `--igdb` as authoritative, and import into
a clean database rather than on top of the seed for anything real.

### Replacing the seed with the real catalog

```bash
npm run api:seed -- --igdb --all --drop-existing
```

`--drop-existing` empties the catalog first. Every foreign key to `games.id` is
`ON DELETE CASCADE`, so this also deletes **every review, backlog entry, favorite
and trending score** in the database — it prints what it is about to destroy and
waits for you to type `drop`. Pass `--yes` to skip the prompt in a script; without
a TTY it refuses rather than assuming. Accounts, follows and genre/platform lookup
rows survive. Uploaded media is left in the object store, unreferenced.

`--all` pages by id rather than by offset — a full sync takes ~700 requests at
IGDB's four-per-second ceiling, and offsets over a result set upstream is still
editing silently skip rows. Each page is committed as it lands and prints the id
it reached, so an interrupted run resumes rather than restarts:

```bash
npm run api:seed -- --igdb --all --after-id 145280   # pick up where it stopped
npm run api:seed -- --igdb --all --max-pages 2       # trial run first
```

Both live paths ask IGDB for `category = 0` — main games only, no DLC, expansions,
bundles or ports. That matters far more at 350k games than at 200.

### Trending

Trending is materialised, not computed per request:

```bash
npm run api:trending                   # the default 7d window
npm run api:trending -- --window 24h
```

It aggregates reviews, backlog adds and likes inside the window. With no activity
to aggregate `GET /games/trending` returns an empty list and Discover says so —
it does not fall back to an arbitrary list dressed up as a ranking. SPEC §6.11
wants this on a schedule; until the worker exists it is a CLI command.

Trending is also the first cold-start source for recommendations, so running this
is what makes "Recommended for you" useful to a reader who has not rated anything
yet. See the recommendation design notes.

---

## Regenerating the shared types

The Python service is the single source of truth. After changing any endpoint or
schema:

```bash
npm run gen:types
```

This dumps FastAPI's OpenAPI document to `packages/api-types/openapi.json` (no
database required) and regenerates `src/schema.d.ts`. Commit both.

---

## Auth design notes

The one API serves a browser and a native app, which want different token
storage, so token delivery is dual-mode:

- Every auth response returns the token pair **in the JSON body** — this is what
  the mobile client will read and put in `expo-secure-store`.
- The same response also sets the refresh token as an **httpOnly cookie** scoped
  to `/api/v1/auth`. The web client relies on that and keeps the access token in
  React memory only, never in `localStorage`, so an injected script has nothing
  durable to steal. On page load it calls `/auth/refresh` once and the cookie
  silently restores the session.

Other properties worth knowing:

- **Refresh tokens rotate.** Each login opens a token _family_; using a token
  revokes it and links it to its successor. Presenting an already-rotated token
  means a copy leaked, so the whole family is revoked (SPEC §9).
- **Only digests are stored.** Refresh and reset tokens are opaque random
  strings; the database holds SHA-256 digests, so a database leak yields nothing
  usable.
- **Password reset is single-use**, expires in an hour, invalidates any earlier
  outstanding link, and revokes every session on success.
- **No account enumeration.** Login returns one message for "no such user" and
  "wrong password" and spends the same time hashing either way; the reset
  endpoint always returns 202.
- **Handles and emails are stored lower-cased**, so uniqueness is
  case-insensitive with a plain unique index.

## Catalog design notes

- **Search matches substrings and ranks by similarity.** A btree index can't serve
  `ILIKE '%witcher%'`, so migration `de134620f0fc` installs `pg_trgm` and adds GIN
  trigram indexes over `games.title`, `users.username` and `users.display_name`.
  The substring filter decides _what_ matches; `similarity()` decides the order,
  which is what puts "Hades" above "Hades II" for `q=hades`.
- **Pagination is keyset, not OFFSET.** Every ordering ends in the row id so the
  comparison is total; without that, ties let rows repeat or vanish between pages.
  Nullable sort keys are wrapped in `COALESCE` for the same reason — NULL breaks
  the row-value comparison, and undated games would silently drop out of a
  newest-first list.
- **Wildcards in a query are escaped**, so searching for `100%` is a search for a
  literal `100%` rather than a match-all.
- **Privacy is enforced in the query**, not after it. `search/users` computes
  visibility as a correlated subquery in the same statement that produced the row,
  so a gated stat cannot be forgotten on the way out.

### Endpoints so far

| Method | Path                                   | Notes                                                                           |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| POST   | `/api/v1/auth/register`                | 201, signs in immediately                                                       |
| POST   | `/api/v1/auth/login`                   | email **or** username                                                           |
| POST   | `/api/v1/auth/refresh`                 | body token or cookie; rotates                                                   |
| POST   | `/api/v1/auth/logout`                  | idempotent; `all_sessions` supported                                            |
| POST   | `/api/v1/auth/password-reset`          | always 202                                                                      |
| POST   | `/api/v1/auth/password-reset/confirm`  | consumes token, revokes sessions                                                |
| GET    | `/api/v1/users/me`                     | bearer auth                                                                     |
| PATCH  | `/api/v1/users/me`                     | edit display name, bio, privacy                                                 |
| PUT    | `/api/v1/users/me/avatar`              | multipart; `DELETE` removes it                                                  |
| GET    | `/api/v1/users/me/favorites`           | `POST` to pin, `PUT` to reorder, `DELETE /{gameId}` to unpin                    |
| GET    | `/api/v1/users/username-available`     | signup UX helper                                                                |
| GET    | `/api/v1/users/{username}`             | public profile; shell only if gated                                             |
| GET    | `/api/v1/users/{id}/stats`             | SPEC §6.8; 403 if gated                                                         |
| GET    | `/api/v1/users/{id}/reviews`           | profile grid; `?game=` narrows; 403 if gated                                    |
| GET    | `/api/v1/users/{id}/followers`         | cursor-paginated; 403 if gated                                                  |
| GET    | `/api/v1/users/{id}/following`         | cursor-paginated; 403 if gated                                                  |
| POST   | `/api/v1/follow/{id}`                  | follows, or requests if they're private; idempotent                             |
| DELETE | `/api/v1/follow/{id}`                  | unfollow, or withdraw your request                                              |
| GET    | `/api/v1/follow/requests`              | requests awaiting your approval; cursor-paginated                               |
| POST   | `/api/v1/follow/requests/{id}/accept`  | approves; the requester can see gated content immediately                       |
| POST   | `/api/v1/follow/requests/{id}/decline` | removes the request; the requester is not told                                  |
| DELETE | `/api/v1/followers/{id}`               | drop one of your followers                                                      |
| POST   | `/api/v1/reviews`                      | one per user per game; 409 points at editing                                    |
| GET    | `/api/v1/reviews/{id}`                 | full detail + carousel; 403 if the author is gated                              |
| PATCH  | `/api/v1/reviews/{id}`                 | owner only; moves `updated_at`                                                  |
| DELETE | `/api/v1/reviews/{id}`                 | owner only; removes the stored media too                                        |
| POST   | `/api/v1/reviews/{id}/media`           | multipart; returns PENDING                                                      |
| DELETE | `/api/v1/reviews/{id}/media/{mediaId}` | renumbers the carousel and deletes the objects                                  |
| POST   | `/api/v1/reviews/{id}/like`            | idempotent; returns the review's counters                                       |
| DELETE | `/api/v1/reviews/{id}/like`            | unlike; a no-op if it was not liked                                             |
| GET    | `/api/v1/reviews/{id}/likes`           | who liked it, newest first; 403 if the author is gated                          |
| POST   | `/api/v1/reviews/{id}/comments`        | `parent_comment_id` replies; one level only                                     |
| GET    | `/api/v1/reviews/{id}/comments`        | threads oldest first, replies nested; 403 if gated                              |
| PATCH  | `/api/v1/comments/{id}`                | owner only; moves `updated_at` and sets `edited`                                |
| DELETE | `/api/v1/comments/{id}`                | owner only; a top-level comment takes its replies                               |
| GET    | `/api/v1/feed`                         | reviews **and** backlog activity from accounts you follow, newest first; cursor |
| GET    | `/api/v1/feed/suggestions`             | the empty state: who to follow, and what is trending                            |
| GET    | `/api/v1/users/me/lists`               | your four backlog lists; `?status=` narrows to one                              |
| GET    | `/api/v1/users/{id}/backlog`           | someone else's lists; 403 if gated                                              |
| PUT    | `/api/v1/backlog/{gameId}`             | upsert: adds to a list, or moves between them                                   |
| DELETE | `/api/v1/backlog/{gameId}`             | take a game off the backlog entirely                                            |
| PUT    | `/api/v1/backlog/order`                | reorder one list; must name every game on it                                    |
| GET    | `/api/v1/notifications`                | your inbox, newest first; read and unread together; cursor                      |
| GET    | `/api/v1/notifications/unread-count`   | what the badge shows; polled                                                    |
| POST   | `/api/v1/notifications/read`           | mark some read, or all of them when `ids` is omitted                            |
| GET    | `/api/v1/games`                        | browse: `genre`, `platform`, `sort`, `cursor`                                   |
| GET    | `/api/v1/games/{id}`                   | full detail with genres + platforms                                             |
| GET    | `/api/v1/games/genres`                 | browse facet                                                                    |
| GET    | `/api/v1/games/platforms`              | browse facet                                                                    |
| GET    | `/api/v1/games/trending`               | materialised ranking for a window                                               |
| GET    | `/api/v1/games/discover`               | every Discover section in one call                                              |
| GET    | `/api/v1/search/games`                 | title search, rate limited                                                      |
| GET    | `/api/v1/search/users`                 | handle/name search, privacy-gated                                               |
| GET    | `/health`                              | liveness                                                                        |

The catalog and search endpoints are readable signed-out — a game is not user
content. A token changes only what a _private_ account exposes: `search/users`
returns private accounts either way (otherwise nobody could send a follow
request) but withholds their stats unless the viewer is the account itself or an
approved follower (SPEC §6.7).

Lists are **keyset-paginated**: pass the `next_cursor` from a response back as
`?cursor=`. A cursor is a position, not a saved query, so resend the filters with
it.

SPEC §8 writes these without a version prefix; they are served under
`/api/v1` (configurable via `API_V1_PREFIX`).

## Profile design notes

- **A private account still has a public shell.** `GET /users/{username}` returns
  200 to anyone: avatar, handle, display name, bio and the follower/following
  _counts_. Hiding the account entirely would make it impossible to send a follow
  request, which SPEC §6.7 requires. What the gate controls is `can_view_content`
  — false means `stats` is null and `favorite_games` is empty. The follower and
  following _lists_ are named as gated content in §6.7, so those endpoints answer
  403 rather than returning an empty page that would read as "no followers".
- **One expression decides visibility.** `users.content_is_visible_to` is the
  correlated subquery used by both the profile endpoints and `search/users`, so
  the two can't drift into disagreeing about who may see what.
- **Reading and writing the graph are separate modules.** `services/users.py`
  reads it — the gate, the lists, the counts — and `services/social.py` writes
  it. Nothing downstream was taught about follows, which is why an approved
  request unlocks reviews, stats and lists all at once.
- **Stats degrade to zero, not to an error.** Reviews now feed them; backlog
  items arrive in a later slice, so `completed_count` and `backlog_count` are
  still computed over an empty table. `average_rating` comes back `null` rather
  than `0.0` — the mean of nothing is not zero, and a zero would render as a
  one-star critic.
- **PATCH distinguishes absent from null.** Omitting a key leaves the column
  alone; sending `null` clears it. That is the only way to erase a bio, and it
  is why the schema fields are all nullable with `exclude_unset` on the write.

### Uploads

`app/services/storage.py` is the shared helper behind avatars and review media.
Two things it does that are easy to leave out:

- **The declared content type is ignored.** A browser will send
  `Content-Type: image/png` for anything, and the bucket serves back what it was
  given — so an "avatar" of HTML becomes a stored XSS on the bucket origin. The
  stored type is sniffed from the leading bytes instead, and anything not in the
  policy's allow-list is a 415.
- **Keys are server-generated** (`avatars/{user_id}/{random}.{ext}`), so a
  crafted filename can't traverse out of its prefix or overwrite anyone else's
  object. Replacing an avatar mints a new key and deletes the old object _after_
  the row commits, so a failed commit can't orphan the image the profile still
  points at.

The test suite stubs the three functions that cross the network and exercises the
rest for real, so `npm run api:test` needs Postgres but not MinIO.

---

## Review design notes

- **One review per user per game**, enforced by `uq_reviews_user_id_game_id`. The
  service checks first so the 409 can point at editing rather than surfacing a
  constraint violation. A client that hits it finds the review to edit with
  `GET /users/{id}/reviews?game={gameId}`.
- **Ratings travel twice.** `rating` is the stored 1-10 integer and `stars` the
  0.5-5.0 value SPEC §6.3 displays. Deriving the second one server-side is what
  stops four clients from each inventing their own halving.
- **The game is not editable.** Repointing an existing review at a different game
  would silently rewrite what everyone who liked or commented on it was
  responding to. Delete and write a new one instead.
- **Like and comment counts are computed in one place.** `interaction_stats`
  groups the `likes` and `comments` tables over a whole page in three queries,
  and every surface — detail, profile grid, whatever the feed adds — renders what
  it returns. The Interactions endpoints write rows and read the counters back
  through that same function, so there is no second way to count.
  `viewer_has_liked` is false when signed out because there is nobody to have
  liked it, not because the answer is unknown.
- **Reviews inherit their author's privacy.** Every read goes through the same
  `require_content_access` the profile endpoints use, so a private account's
  reviews are invisible on the detail screen and the profile grid alike.

## Social design notes

- **One row, and the follower owns it.** `POST /follow/{id}` creates it and
  `DELETE /follow/{id}` removes it, whether it is an accepted follow or a request
  nobody has answered. Two verbs for the same row would only invite a client to
  pick the wrong one.
- **Idempotent by design.** Following someone you already follow reports the
  state you are in rather than failing. Clients retry, and a double-tapped button
  is not a mistake the user can learn anything from. The response carries the
  followee's `follower_count`, so the number beside the button moves without a
  second request.
- **Private → public does not approve anything**, as SPEC §6.7 requires. But a
  request left over from before the switch is unanswerable — a public account has
  no reason to open its requests screen — so following _again_ resolves it, and
  on a public account that means following. The switch approves nothing; the
  follower asking again does.
- **Declining is silent and leaves no record.** SPEC §6.12 lists a notification
  for a request approved and none for one turned down. The requester's button
  falls back to "Follow" and they may ask again.
- **`responded_at` means somebody answered.** It stays null for an instant follow
  of a public account, because there was no request to answer — which makes
  `responded_at is not null` a usable "went through approval".
- **Notifications have exactly one seam.** `services/notifications.emit` is
  called before the commit, so the row lands in the same transaction as the
  follow that caused it. It writes a real notification now, and none of these
  call sites moved when it started to — see the notification design notes.

## Interaction design notes

- **One level of threading, refused rather than flattened.** A reply's parent
  must be a top-level comment on the same review (SPEC §6.10). Replying to a
  reply is a 400, not a silent re-parent to the top of the thread — moving a
  reply changes who it reads as answering. The web client offers "Reply" only on
  a top-level comment, so no sequence of clicks can produce the rejected request.
- **Liking is idempotent, and announces itself once.** A second `POST` writes
  nothing and notifies nobody; the response is the count you already had.
  Unliking something you never liked is a success — the caller wanted not to have
  liked it, and they do not.
- **The gate is the author's, not the review's.** Every like, comment and list
  goes through the same `require_content_access` the read path uses, so a private
  account's reviews cannot be liked or commented on by a non-follower for exactly
  the reason they cannot be read. Approve the follow and all of it opens at once.
- **Nobody is notified about their own action.** Liking your own review, or
  commenting on it, emits nothing. A reply notifies the review's author
  (`REVIEW_COMMENTED`) and the person answered (`COMMENT_REPLIED`) — unless they
  are the same person, who hears about it once.
- **Deleting your comment always works**, even from an account that has since
  lost access to the review. Words you can neither reach nor retract would be a
  worse outcome than letting a former follower tidy up after themselves.
- **Comments read oldest first**, unlike every other list in the app. It is a
  conversation; a reply before the thing it answers only makes sense in
  hindsight. `ix_comments_review_id_created_at` is in that order, so the keyset
  walks the index forwards. Pages count _threads_, so a popular comment can never
  push its own replies onto page two.

## Feed design notes

- **A feed review is still the profile grid's review.** `services/feed.py` builds
  its review payloads from `reviews.select_reviews()` and `reviews.with_stats` —
  the same projection, eager loads and counters the profile grid has always used.
  Nothing about a feed row is assembled separately, which is why a like written by
  `services/interactions.py` moves the number on it without the feed module
  knowing likes exist.
- **Two sources, one ordering.** Since the backlog slice the feed unions review
  ids with backlog ids, pages the _keys_ through the shared `fetch_keyset_keys`,
  and loads each kind afterwards. One cursor therefore means one position in the
  mixed list. Merging two separately paged lists client-side was the obvious
  alternative and is wrong: the cursor would have to remember a position in each,
  and anything that arrived between two requests would land on the seam.
- **The follow edge _is_ the privacy gate.** An ACCEPTED edge is what SPEC §6.7
  calls approval, so the row that puts a review in your feed is the row that
  entitles you to see it. There is deliberately no second `require_content_access`
  here: it could only agree, and a redundant check is one that can drift. Unfollow
  and both go at once.
- **PENDING is not following.** A request to a private account puts nothing in
  your feed. That is the whole point of the approval, and a feed is where a leak
  would be most visible.
- **Feed items are envelopes, not reviews.** Every item carries a `type`
  discriminator (`"review"`, `"backlog_activity"` or `"recommended_review"`), its
  own `id`, and `occurred_at`. SPEC §6.4 says Home is unified, so clients branched
  on `type` from the first version — which is why adding activity, and then the
  recommended blend, each cost one union member and one `if` rather than a new
  response shape. The `id` and the timestamp are on the envelope precisely so a
  client can key and order a list _before_ it knows what kind of item it is
  holding.
- **The blend is a third arm of the same union.** SPEC §6.4 wants recommended
  content interleaved and "clearly distinguishable". It is selected by the same
  keys query, ordered by the same timestamp and walked by the same cursor as
  everything else, so a recommended item takes its place in time rather than
  sitting in a block at the top. Merging a separately fetched list in Python was
  the alternative and is wrong for the same reason it was wrong for activity: an
  item outside the cursor either repeats on the next page or falls down the seam
  between two.
- **A recommended item says why it is there.** `reason` is `recommended_game`
  (the reader is likely to enjoy the game) or `suggested_account` (the author
  rates the way they do). It is a separate `type` and not a `recommended: true`
  flag because a flag is what a client forgets to read, and a stranger's review
  rendered as though the reader had chosen to follow them is the one way this
  feature misleads.
- **Nothing is blended into an empty Home.** A viewer who follows nobody gets the
  SPEC §6.4 empty state, not a page of recommendations dressed up as a feed. A
  blend is something mixed into a feed; on its own it is not one.
- **The blend carries the privacy gate explicitly.** It is the only thing in the
  feed that does not arrive through a follow edge, so it is the only thing that
  cannot rely on one. The recommended arm puts `users.content_is_visible_to` in
  its WHERE — the shared expression, in the form that fits inside a query —
  rather than a hand-written `is_private = false`, and excludes authors the viewer
  already follows so nothing arrives twice.
- **Your own reviews are not in your Home.** SPEC §6.4 defines the feed as the
  accounts you follow, and `no_self_follow` means there is no edge to yourself to
  find. Your reviews are on your profile.
- **The empty state is a prompt, not a second Discover.** Five public accounts you
  do not already follow — pending requests excluded, because suggesting someone
  you are waiting on reads as though the request never went through — plus the
  materialised trending ranking. Taste matches lead and most-followed fills the
  rest; the blend uses only the taste-matched half, because threading the accounts
  everybody already follows through everybody's feed would make one Home look much
  like another. It is a separate endpoint, so the request every scroll makes does
  not carry a section read once.

## Recommendation design notes

`services/recommendations.py` is shared: Discover's "Recommended for you" section
and the Home blend read the same ranking, so the two surfaces cannot disagree
about what a reader likes.

- **Two signals, blended, both explainable.** _Content_ is genre affinity, built
  from the genres of games the viewer rated ≥ 7/10 (weighted 1–4 by how far above
  that) and from their pinned favorites (weighted 4, because SPEC §6.2 makes
  favorites a capped, curated choice). _Collaborative_ is games rated ≥ 7 by
  people whose ratings agree with the viewer's, where agreement on each co-rated
  game falls off linearly and reaches zero four points apart. Similarity is a
  _sum_, not an average, so someone who agreed about thirty games outranks
  someone who agreed about one.
- **Both signals are rescaled to 0..1 before they are added**, 0.6 content /
  0.4 collaborative. Without the rescale the blend would be decided by whichever
  signal happened to produce larger raw numbers, and since one counts genre
  overlaps and the other sums similarities, that compares nothing. Content leads
  because collaborative filtering is the weaker signal on a young instance, where
  a handful of overlapping ratings can make two people look alike by accident.
- **It is arithmetic over rows, and that is the point.** No model, nothing
  persisted, no new dependency — so the same data gives the same ranking every
  time, and the tests can work the expected answer out on paper instead of
  pinning whatever the code happened to produce.
- **Nothing you already have an opinion about.** Reviewed, on any of the four
  backlog lists, or pinned as a favorite. Favorites are excluded for the same
  reason as the other two and not as a third rule: being told to try your own
  favorite is the one recommendation that makes the section look broken.
- **Cold start is trending, then popular all-time**, minus what you already know
  about — a reader can be cold on ratings and still have thirty games shelved,
  so both sources are read deep and filtered afterwards. Signed-out Discover
  takes the same path, which is why the section never errors and never claims to
  be tailored to nobody.
- **An instance with no activity gets an empty section, not a filled one.** A
  catalog is not a ranking, and Discover already has a New Releases row for the
  games nobody has touched.
- **Ties are honest.** Equal scores break on the row id, like every other ranked
  list here, so the tests compare tied groups as sets — the ranking says those
  games are equally good matches, not that one of them is second.

## Backlog design notes

- **Four lists, one row.** SPEC §6.9 says a game holds at most one status, so
  `PUT /backlog/{gameId}` is an upsert: it adds a game and it moves a game, and
  the caller does not have to know which one they are doing. The unique
  constraint on (user, game) is what stops a profile ever claiming a game is
  both completed and unplayed.
- **`status_changed_at`, not `updated_at`.** The one new column this slice
  needed. Activity events are derived from the backlog row rather than from an
  events table, and `updated_at` moves when a list is _reordered_ — which would
  announce somebody tidying their queue to all their followers, and, since it is
  the feed's sort key, reshuffle rows between pages while they were being read.
  Re-sending a status a game already has does not move it either, so a retried
  request cannot re-announce anything.
- **The event says where a game landed, not how it got there.** One row per game
  means the row remembers the current status and nothing else. "Sam completed
  _Hades_" is what SPEC §6.11 asks for; a `from` field the data cannot back would
  be worse than not having one.
- **Lists inherit account privacy, so they use the same gate.**
  `require_content_access` — the one the reviews grid and the stats already go
  through. In the feed, the accepted follow edge is that same approval, which is
  why activity needs no rule of its own there either.
- **Positions stay dense per list.** Appending is `len(list)`, a reorder is an
  index assignment, and moving a game closes the gap it left. A reorder must name
  exactly the games on that list — the rule favorites already used, because a
  short list means a stale client and reconciling it would drop whatever another
  tab had just moved.
- **One backlog fetch for the whole web client.** The add-to-list control appears
  on Search, Game Detail and a review (SPEC §6.9), and all three read a shared
  `gameId → status` map loaded once and lazily. Per-card requests would be a
  request per result; per-screen state would let two screens disagree.
- **`BACKLOG_GAME_REVIEWED` fires from review creation, not from here.** The
  recipients are the author's approved followers who hold that game on an
  unplayed list, and finding them is `notifications.backlog_reviewers_of` — a
  notification's recipient list is not something reviews should have to know.

## Notification design notes

- **One function creates every notification.** `services/notifications.emit` is
  the only writer, and every producer — follows, likes, comments, replies,
  backlog-game-reviewed — has called it since its own slice. Filling in its body
  was the whole of the write side: no call site moved, and there is no second
  path by which a notification can come into existence.
- **It writes into the caller's transaction and never commits.** A notification
  about an action that rolls back would be a lie, and the only way to prevent one
  is for the row and the action to share a transaction. `test_notifications.py`
  asserts it directly by rolling a savepoint back over an `emit`.
- **Nobody is notified about themselves**, checked in `emit` as well as in each
  producer. The producers all have their own reasons to check; the guard at the
  seam is what stops a producer written next year from reintroducing it.
- **The targets are nullable fields, not a discriminated union.** Unlike
  `FeedItem`, every notification renders identically — avatar, sentence,
  timestamp — and only the sentence differs, so `review` and `comment` are
  optional and `type` says which to expect. Seven union members would be
  flattened back into one row component by the first client to consume them.
- **The API sends the parts of a sentence; the client writes the sentence.**
  `lib/notifications.ts` holds all seven phrasings, so wording changes without an
  API deploy and the row component has no seven-way switch. Every phrase survives
  a deleted target — a review can go away after the notification about it was
  written, and "liked your review of undefined" is worse than "liked your review".
- **Opening the tab does not mark anything read.** Marking is a press, on one row
  or on "Mark all read". Clearing a list because somebody glanced at it is the
  behaviour people complain about in every product that does it.
- **`ids: []` marks nothing; omitting `ids` marks everything.** The other reading
  of an empty array is the dangerous one: a client that meant "mark these" and
  computed an empty selection would silently clear the whole badge.
- **Marking somebody else's notification is a zero, not a 403.** Ownership is a
  WHERE clause, so a foreign id matches no row. Refusing would confirm that the
  id is real and whose it is.
- **The badge is polled, at one minute.** Delivery is in-app only (SPEC §6.12
  puts push post-MVP), so there is nothing to push the number down. The poll is a
  floor: marking read takes the new count from the same response that did the
  marking, so the badge moves immediately.
- **Per-category preferences (SPEC §6.13) are not here.** They gate every
  producer at once, so they belong in front of `emit` and in the Settings slice —
  not as a check repeated at seven call sites.

### The media pipeline

Upload is synchronous and cheap; processing is not:

| Stage      | Does                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Upload     | Sniffs the type, applies the size cap for its kind, reads a clip's duration, stores the original, marks it `PENDING` |
| Processing | Probes dimensions, renders a thumbnail, flips to `READY` (or `FAILED`)                                               |

- **Limits from SPEC §6.3**: 10 items per review, at most one video, clips ≤ 60s,
  images ≤ 15 MB, video ≤ 100 MB. The duration is read at upload rather than
  during processing so an over-long clip is a 400 the user sees immediately
  instead of a `FAILED` item minutes later.
- **It runs offline.** Images go through Pillow; a clip's length is read straight
  out of the ISO base media container (`moov` → `mvhd`). No ffmpeg, no probe
  subprocess, nothing to install beyond the Python dependencies. The cost is that
  video is validated but **not transcoded** and gets **no poster frame** —
  `thumbnail_url` stays null for clips and grid surfaces fall back to the game's
  cover art.
- **MP4 and QuickTime only.** WebM would need an EBML parser to read a duration,
  and a clip whose length can't be measured can't be held to the 60-second cap,
  so it is refused rather than let through unchecked.
- **There is no queue yet.** Uploads schedule processing on FastAPI's background
  tasks, and a catch-up worker sweeps up anything a restart stranded:

  ```bash
  npm run api:media                          # one pass
  npm run api:media -- --watch               # keep polling
  ```

  `process_media` only ever advances a row out of `PENDING`, so the two cannot
  double-process the same item. SPEC §6.11 wants this on a schedule; same
  reasoning as the trending CLI.

**Known gap:** SPEC §9 asks for EXIF/location stripping on uploaded media. That
is not implemented — the stored original keeps its metadata. Thumbnails are
re-encoded and so lose it, but the full-size photo a review links to does not.
Worth closing before any real user posts a photo.

---

## Before deploying anywhere real

[`DEPLOY.md`](./DEPLOY.md) is the runbook: every required production variable
and where to get it, the build/migrate/start sequence, the HTTPS switches, and
the merge-to-`main` pipeline. What follows is the list of things that are still
rough at the edges.

- The app refuses to boot when `ENVIRONMENT` is `staging` or `production` and
  `SECRET_KEY`, the CORS origins, the cookie flags, SMTP or S3 are still at a
  development default. It reports all of them at once.
- Rate limiting uses slowapi's in-memory store, which is per-process. Point it
  at Redis before running more than one API replica — or more than one uvicorn
  worker, which is the same problem.
- The image already runs uvicorn with `--proxy-headers`, but set
  `FORWARDED_ALLOW_IPS` to the load balancer or the IP recorded against refresh
  tokens is still the balancer's rather than the client's.
- The search migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, which needs
  a role with CREATE on the database. That is the master user on RDS/Cloud SQL,
  where pg_trgm is allow-listed; if migrations run as a restricted role, have a
  DBA install the extension once and the migration becomes a no-op.
- Trending is a CLI command, not a scheduled worker yet. Put `npm run api:trending`
  on a cron (or move it into the queue) before Discover matters.

- Media processing runs in-process on FastAPI's background tasks. Move it behind
  a real queue before uploads get heavy — a 100 MB clip is read fully into memory
  on the way to the bucket, and a restart drops whatever was mid-flight (the
  catch-up worker recovers it, but only when it next runs).
- Strip EXIF from uploaded photos (SPEC §9) before real users post any.

## Next slices

The MVP surface from SPEC.md is complete. What is left is settings (SPEC §6.13,
including notification categories, which belong in front of `notifications.emit`
rather than at each of its seven call sites) → DMs (SPEC §6.14, the one part of
the §7 schema with no endpoints).
