---
type: domain_concept
title: "Profiles and Privacy"
description: "User profiles, favorite games, profile stats, follower lists, and the content_is_visible_to privacy gate."
tags: [domain, profiles, privacy, favorites, stats]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/users.py
---

# Profiles and privacy

## The privacy rule (SPEC §6.7)

An account is public or private (`users.is_private`). A private account's
**shell** stays public: username, display name, avatar, bio and counts, so that
people can find it and send a follow request. Its **content** (reviews, stats,
backlog lists, interactions, and its activity in other people's feeds) is
visible only to the owner and to ACCEPTED followers.

`content_is_visible_to(viewer_id)` in `services/users.py` is **the one
expression** that encodes this rule, and `require_content_access` is its awaited
form. Profiles, reviews, interactions, backlog reads, user search and the
feed's recommended blend all reuse it. The follow-based part of the feed
doesn't need it, because the ACCEPTED edge that puts an item there is itself
the approval. When a follow edge is accepted, everything unlocks at once with
no other code involved. **Never re-implement this check** (for example with a
hand-written `is_private = false`). A gated read raises `ProfileIsPrivateError`
(403).

What the gate controls on a profile:

- `GET /users/{username}` returns 200 to anyone. When the viewer is gated,
  `can_view_content` is false, `stats` is null and `favorite_games` is empty.
- The follower and following **lists**, stats, reviews and backlog return
  **403** when gated, rather than an empty page that would read as "none".

## Profiles

- **Favorites:** at most 6 games (`MAX_FAVORITE_GAMES`), stored in order with
  dense positions 0..n-1, which close up after a removal. They are added,
  reordered and removed under `/users/me/favorites`.
- **Stats** (SPEC §6.8 — light gamification, no leaderboards): `games_reviewed`,
  `review_count`, `average_rating` (on the 1–10 scale; **null, not 0**, when
  nothing has been rated), total playtime, completed count, and a zero-filled
  10-bucket rating distribution.
- **`PATCH /users/me` tells an absent field from a null one** (`exclude_unset`).
  Omitting a key leaves it alone, and sending `null` clears it. That is the only
  way to erase a bio. The editable fields are display name, bio and
  `is_private`.
- **Avatar uploads** are type-sniffed and have metadata stripped (off the event
  loop) before storage. The key is server-generated
  (`avatars/{user_id}/{random}.{ext}`). Replacing an avatar deletes the old
  object only *after* the row commits, so a failed commit can't orphan the
  image the profile still points to. See [Reviews and media](reviews-and-media.md).

## Endpoints

`GET|PATCH /users/me` · `PUT|DELETE /users/me/avatar` ·
`GET|POST|PUT /users/me/favorites` · `DELETE /users/me/favorites/{game_id}` ·
`GET /users/me/lists` · `GET /users/{username}` · `GET /users/{user_id}/stats` ·
`GET /users/{user_id}/reviews` · `GET /users/{user_id}/backlog` ·
`GET /users/{user_id}/followers` · `GET /users/{user_id}/following`

The literal `/me…` routes must stay declared before `/{username}` (see
`api/v1/users.py`).

## Code

- API: `app/api/v1/users.py`, `app/services/users.py`, `app/schemas/user.py`
- Clients: `packages/core/src/profile.ts`, web `src/app/profile/[username]/`,
  mobile `src/components/profile-screen.tsx`, `favorite-games.tsx` in both apps
- Tests: `test_users_*.py`

Related: [Social graph](social-graph.md) · [Users and auth tables](../models/users-and-auth.md)
