---
type: domain_concept
title: "Interactions: Likes and Comments"
description: "Likes and one-level threaded comments on reviews, gated by the review author's privacy."
tags: [domain, likes, comments, interactions]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/interactions.py
---

# Interactions: likes and comments

## Rules that must keep holding

- **Interactions inherit the review author's privacy.** Every entry point
  resolves the review through `_accessible_review`, which calls
  `users.require_content_access`.
- **One level of threading, enforced by refusal, not flattening.** A reply's
  parent must be a top-level comment on the same review. A reply to a reply is
  a 400 (`CommentDepthError`), never a silent re-parent. Deleting a top-level
  comment deletes its replies too.
- Comments are 1–500 characters (a check constraint enforces this). Only the
  author may edit (which moves `updated_at` and sets `edited`) or delete a
  comment. **Deleting your own comment always works**, even after you've lost
  access to the review, because the delete path checks ownership only.
- **Comments are listed oldest first**, unlike every other list in the app,
  because a thread is a conversation. Pages count *threads*, so replies never
  spill onto the next page.
- **Liking is idempotent.** A second like writes nothing and notifies nobody.
  Removing a like that doesn't exist still succeeds.
- **Nobody is notified about their own action.** For example, liking your own
  review emits nothing.
- **One place counts.** Counters are read through
  `reviews.interaction_stats`, the same function every review response uses,
  so a like recorded here and a like shown on a feed card can never disagree.
- Notifications: `REVIEW_LIKED`, `REVIEW_COMMENTED`, and `COMMENT_REPLIED`.
  `COMMENT_REPLIED` goes to the parent comment's author, unless that author is
  the replier or the review's author, who already got `REVIEW_COMMENTED`.

## Endpoints

`POST|DELETE /reviews/{review_id}/like` · `GET /reviews/{review_id}/likes` ·
`POST|GET /reviews/{review_id}/comments` · `PATCH|DELETE /comments/{comment_id}`

## Code

- API: `app/api/v1/interactions.py`, `app/services/interactions.py`,
  `app/schemas/interactions.py`
- Clients: `packages/core/src/interactions.ts`, `like-button.tsx` and
  `comments.tsx` in both apps
- Tests: `test_interactions_likes.py`, `test_interactions_comments.py`

Related: [Review tables](../models/reviews.md) · [Reviews and media](reviews-and-media.md)
