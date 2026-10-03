---
type: domain_concept
title: "Home Feed"
description: "The unified Home feed: followed reviews, backlog activity and a capped recommended blend, keyset-paged under one cursor."
tags: [domain, feed, recommendations, pagination]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/feed.py
---

# Home feed

## Shape

A feed item is an **envelope** with a `type` discriminator, not a bare review:

| `type` | Payload | Source |
| --- | --- | --- |
| `review` | a review with counters | reviews by active accounts the viewer follows (ACCEPTED edges only; the viewer's own reviews are not included) |
| `backlog_activity` | a backlog status change | followed accounts' `backlog_items`, last **14 days** only |
| `recommended_review` | a review plus a `reason` (`recommended_game` / `suggested_account`) | reviews from the last **30 days** of up to **12** recommended games or up to **5** taste-matched accounts |

`id` and `occurred_at` sit on the envelope. Clients branch on `item.type`
(`packages/core/src/feed.ts`). **Add new kinds as new union members; never
rename existing values.**

## How it is paged

`_feed_keys` takes the UNION of `(id, occurred_at, kind)` across every source,
`fetch_keyset_keys` seeks through the union with one cursor, and `_hydrate`
loads each kind in a single query. Do not merge separately paged lists in Python.
The cursor would then have to track a position in each list, and items could be
skipped or repeated.

`backlog_items.status_changed_at` is the sort key for activity. It moves only
when the status changes, so reordering a list never announces itself to
followers. An activity event says where a game landed, not where it came from,
because the row holds only its current status.

A feed review uses the same projection as the profile grid
(`reviews.select_reviews()` and `reviews.with_stats`), so like and comment
counts can't drift between surfaces.

## Privacy and the blend

- **The follow edge is the gate** for `review` and `backlog_activity`. An
  ACCEPTED edge *is* the approval, so the feed deliberately has no second
  `require_content_access` for these, which could only agree or drift. PENDING
  is not following and adds nothing to the feed.
- **The blend carries the gate explicitly.** It is the only part of the feed
  that doesn't arrive through a follow edge, so it puts
  `users.content_is_visible_to` in its WHERE clause. It also excludes authors
  the viewer already follows, so nothing arrives twice.
- **A recommended item says why it's there.** It is a separate `type`, not a
  `recommended: true` flag, because a client can forget to read a flag and then
  show a stranger's review as if the reader had chosen to follow them.
- When a review qualifies both ways, the reason is `recommended_game`, because
  that's the claim the reader can check against the card.
- **Nothing is blended into an empty Home.** A viewer who follows nobody gets
  the empty state instead.

## Empty state

`GET /feed/suggestions` returns up to five public accounts the viewer doesn't
follow or have a pending request to (taste matches first, then the most
followed), plus the trending ranking. It is fetched once, not with every page.

## Endpoints

`GET /feed` (signed in only) · `GET /feed/suggestions`

## Code

- API: `app/api/v1/feed.py`, `app/services/feed.py`, `app/schemas/feed.py`,
  `app/services/recommendations.py`
- Clients: `packages/core/src/feed.ts`, web `src/app/home/`, mobile `app/(tabs)/index.tsx`
- Tests: `test_feed.py`, `test_recommendations.py`

Related: [Discovery](discovery.md) · [Backlog](backlog.md) · [API contract](../models/api-contract.md)
