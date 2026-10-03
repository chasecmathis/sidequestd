---
type: schema_definition
title: "Social and Backlog Tables"
description: "follows (directed edges with PENDING/ACCEPTED status) and backlog_items (four statuses, dense positions, status_changed_at)."
tags: [models, follows, social, backlog]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/social.py
---

# Social and backlog tables

## `follows` (`models/social.py`)

| Column | Notes |
| --- | --- |
| `follower_id`, `followee_id` | composite PK; both FK to `users`, cascade |
| `status` | `follow_status`: PENDING (request to a private account) or ACCEPTED |
| `responded_at` | when the followee acted on a request |
| `created_at` | |

Check: `no_self_follow`. Indexes: `(followee_id, status)` and
`(follower_id, status)`, because both directions are read. Only ACCEPTED edges
unlock content. `FollowState` (NONE / REQUESTED / FOLLOWING) is derived from
this row and never stored.

## `backlog_items` (`models/backlog.py`)

| Column | Notes |
| --- | --- |
| `user_id`, `game_id` | **unique together**: one status per game per user |
| `status` | `backlog_status`: TO_BE_PLAYED, PLAYING, COMPLETED, DROPPED |
| `position` | ≥ 0, dense within a status (maintained by the service; no unique constraint) |
| `status_changed_at` | server default `now()`; moves **only** when `status` changes; feed sort key |
| `created_at`, `updated_at` | |

Indexes: `(user_id, status, position)` for list reads and `(status_changed_at)`
for feed activity across all followees.

Related: [Social graph](../domains/social-graph.md) · [Backlog](../domains/backlog.md) · [Home feed](../domains/feed.md)
