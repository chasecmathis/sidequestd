---
type: domain_concept
title: "Backlog Lists"
description: "The four status lists (To Be Played, Playing, Completed, Dropped) as one table, with dense ordering and status changes surfaced in the feed."
tags: [domain, backlog, lists, feed]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/backlog.py
---

# Backlog lists

## Rules that must keep holding

- **Four lists, one table.** A game holds at most one status per user, enforced
  by `uq_backlog_items_user_id_game_id`. "Add to a list" and "move to another
  list" are the same operation, `set_status`, which is an idempotent
  `PUT /backlog/{game_id}`.
- **List order** is `LIST_ORDER`: TO_BE_PLAYED → PLAYING → COMPLETED → DROPPED.
  Both the API and the clients draw the headings in this order.
- **Positions are dense (0..n-1) within each status.** Appending uses
  `len(list)`, moving a game closes the gap it leaves, and a reorder must be an
  exact permutation of the current list (otherwise `InvalidBacklogOrderError`).
- **`status_changed_at` moves only when `status` changes.** It is the source of
  feed activity and its sort key, so re-sending the same status or reordering
  never notifies followers twice.
- **Privacy belongs to the reader, not to this module.** Lists inherit account
  privacy, and reads go through the [privacy gate](profiles-and-privacy.md) in
  `services/users.py`.
- **The web client fetches the backlog once.** The add-to-list control appears
  on Search, Game Detail and review pages, and all three read one shared
  `gameId → status` map (`backlog-store.tsx`), loaded once and lazily.
  Per-card fetches would cost one request per result, and per-screen state
  would let two screens disagree.
- **Reads are not cursor-paged.** The grouped shape (`BacklogLists`) always
  returns all four statuses, empty ones included. A backlog is human-scale. If
  that stops being true, add paging per status as a new endpoint.

## Endpoints

Writes: `PUT /backlog/order` (declared before `/{game_id}`) ·
`PUT /backlog/{game_id}` · `DELETE /backlog/{game_id}`

Reads: `GET /users/me/lists` · `GET /users/{user_id}/backlog`

## Code

- API: `app/api/v1/backlog.py`, `app/services/backlog.py`, `app/schemas/backlog.py`
- Clients: `packages/core/src/backlog.ts` (labels), `packages/core/src/backlog-store.tsx`
  (provider), `backlog-control.tsx` in both apps
- Tests: `test_backlog.py`

Related: [Backlog table](../models/social-and-backlog.md) · [Home feed](feed.md) · [Notifications](notifications-and-push.md)
