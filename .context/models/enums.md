---
type: schema_definition
title: "Enums"
description: "Every StrEnum in the API, its values, its Postgres enum type, and whether it is stored or wire-only."
tags: [models, enums, schema]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/enums.py
---

# Enums

Stored enums are Postgres enum types. **Adding a value needs an Alembic
migration** (`ALTER TYPE … ADD VALUE`). Wire values are part of the API
contract: extend them, never rename them.

| Enum | Values | DB type | Where |
| --- | --- | --- | --- |
| `FollowStatus` | PENDING, ACCEPTED | `follow_status` | `models/enums.py` |
| `FollowState` | NONE, REQUESTED, FOLLOWING | — (derived) | `models/enums.py` |
| `MediaType` | IMAGE, VIDEO | `media_type` | `models/enums.py` |
| `ProcessingStatus` | PENDING, PROCESSING, READY, FAILED | `processing_status` | `models/enums.py` |
| `BacklogStatus` | TO_BE_PLAYED, PLAYING, COMPLETED, DROPPED | `backlog_status` | `models/enums.py` |
| `NotificationType` | NEW_FOLLOWER, FOLLOW_REQUEST, FOLLOW_REQUEST_APPROVED, REVIEW_LIKED, REVIEW_COMMENTED, COMMENT_REPLIED, BACKLOG_GAME_REVIEWED | `notification_type` | `models/enums.py` |
| `ConnectionProvider` | STEAM | `connection_provider` | `models/enums.py` |
| `LibraryMatchSource` | EXTERNAL_ID, TITLE | `library_match_source` | `models/enums.py` |
| `PlatformSyncStatus` | OK, PROFILE_PRIVATE, FAILED | `platform_sync_status` | `models/enums.py` |
| `DevicePlatform` | IOS, ANDROID | `device_platform` | `models/enums.py` |
| `GameSort` | `title`, `release_date`, `trending` | — (query param of `GET /games`) | `schemas/game.py` |
| `TrendingWindow` | `24h`, `7d`, `30d` | — (stored as varchar in `trending_scores.window`) | `schemas/game.py` |
| `FeedItemType` | `review`, `backlog_activity`, `recommended_review` | — (wire only) | `schemas/feed.py` |
| `RecommendationReason` | `recommended_game`, `suggested_account` | — (wire only) | `schemas/feed.py` |

A new `NotificationType` also needs wording in `packages/core/src/notifications.ts`
**and** in `_PHRASES` in `apps/api/app/services/push.py`. A new `FeedItemType`
needs a branch in `packages/core/src/feed.ts` and in both clients.

Related: [Models index](index.md) · [API contract](api-contract.md)
