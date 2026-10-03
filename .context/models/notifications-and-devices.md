---
type: schema_definition
title: "Notification and Device Tables"
description: "notifications (actor, type, nullable review/comment targets, read flag) and device_tokens (globally unique Expo push addresses)."
tags: [models, notifications, push, devices]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/notification.py
---

# Notification and device tables

## `notifications` (`models/notification.py`)

| Column | Notes |
| --- | --- |
| `recipient_id` | FK users, cascade |
| `actor_id` | FK users, cascade, nullable |
| `type` | `notification_type` (see [Enums](enums.md)) |
| `review_id`, `comment_id` | nullable deep-link targets; which are set depends on `type` |
| `is_read` | default false |
| `created_at` | |

Indexes: `(recipient_id, created_at DESC)` for the inbox, and a partial index
`(recipient_id) WHERE is_read = false` for the badge. The `review` and
`comment` relationships are one-way (no `back_populates`).

| Type | Targets set |
| --- | --- |
| `NEW_FOLLOWER`, `FOLLOW_REQUEST`, `FOLLOW_REQUEST_APPROVED` | none |
| `REVIEW_LIKED`, `BACKLOG_GAME_REVIEWED` | `review_id` |
| `REVIEW_COMMENTED`, `COMMENT_REPLIED` | `review_id`, `comment_id` |

## `device_tokens` (`models/device.py`)

`user_id` (cascade), `token` (varchar(512), **globally unique**; registering a
token that exists moves it), `platform` (`device_platform`: IOS/ANDROID, for
debugging only), `created_at` and `last_seen_at` (refreshed on each
registration). Index: `(user_id)`.

Related: [Notifications and push](../domains/notifications-and-push.md)
