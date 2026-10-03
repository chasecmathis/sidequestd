---
type: schema_definition
title: "Review Tables"
description: "reviews, review_media, likes and comments: columns, limits, constraints and indexes."
tags: [models, reviews, media, likes, comments]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/review.py
---

# Review tables

Limits are module constants in `models/review.py`. Change them there, and
update the mirrored client limits in `packages/core/src/reviews.ts` and
`interactions.ts`.

## `reviews`

| Column | Notes |
| --- | --- |
| `user_id`, `game_id` | FKs, cascade; **unique together** (`uq_reviews_user_id_game_id`) |
| `rating` | smallint, `BETWEEN 1 AND 10` (half-star stops); `stars` = rating / 2 on the wire |
| `review_text` | varchar(5000) null |
| `playtime_minutes` | int null, ≥ 0; self-reported |

Indexes: `(user_id, created_at DESC)` and `(game_id, created_at DESC)`.

## `review_media`

`type` (`media_type`: IMAGE/VIDEO), `url`, `thumbnail_url`, `width`, `height`,
`duration_seconds`, `alt_text` (500), `position` (0 ≤ p < 10, unique per review)
and `processing_status` (PENDING → PROCESSING → READY / FAILED). The rule of at
most one video per review lives in the service.

## `likes`

Composite PK `(user_id, review_id)`, with `created_at`. Index:
`(review_id, created_at)`.

## `comments`

`review_id`, `user_id`, `parent_comment_id` (a self-FK that cascades),
`text` (1–500, checked) and timestamps. The model allows nesting, but the
service allows **one level** of replies. Index: `(review_id, created_at)`.

Related: [Reviews and media](../domains/reviews-and-media.md) · [Interactions](../domains/interactions.md)
