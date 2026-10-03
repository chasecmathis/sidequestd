---
type: domain_concept
title: "Notifications and Push"
description: "In-app notifications written through emit() inside the caller's transaction, the unread badge, device tokens, and Expo push delivered after commit."
tags: [domain, notifications, push, expo, devices]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/notifications.py
---

# Notifications and push

## In-app notifications

- **`notifications.emit` is the only way a notification is created.** There is
  no `POST /notifications`. Producers call `emit` and know nothing else:
  `social` (follows and requests), `interactions` (likes, comments, replies) and
  `reviews` (`BACKLOG_GAME_REVIEWED` fan-out).
- **`emit` writes but does not commit.** The row joins the caller's transaction,
  so a rolled-back action leaves no notification behind.
- A notification is **the parts of a sentence**: `actor`, `type`, and nullable
  `review` / `comment` targets, which are filled according to `type`. The
  clients compose the wording (`packages/core/src/notifications.ts`), so wording
  can change without an API deploy. All seven types render the same row, which
  is why the schema is deliberately not a discriminated union.
- **Nobody is notified about their own action.** `emit` checks this as well as
  each producer, so a future producer can't reintroduce self-notifications.
- **Marking read:** opening the tab marks nothing; marking takes an explicit
  press on a row or on "Mark all read". In `POST /notifications/read`,
  `ids: []` marks **nothing** and omitting `ids` marks **everything**. Marking
  someone else's notification affects zero rows rather than returning 403, so
  the response never confirms whether an id exists. The response carries the
  new unread count, so the badge updates immediately.
- **Every phrasing survives a deleted target.** "Liked your review" is better
  than "liked your review of undefined".
- **Per-category preferences (SPEC §6.13) belong in front of `emit`**, not at
  each of its call sites.
- The inbox is the caller's own and nobody else's, so no endpoint takes a user
  id. The unread count is served by a partial index (`is_read = false`).
  Clients poll `/notifications/unread-count` every 60 s. That poll is the floor
  that push only makes faster.

## Push (Expo)

- **Devices:** `POST /users/me/devices` registers an `ExponentPushToken`.
  Tokens are **globally unique**, so registering an existing token *moves* it
  to the caller; a handed-over phone must not keep receiving the previous
  account's notifications. `last_seen_at` is refreshed on every registration.
  Rows cascade when the member is deleted.
- **Dispatch:** `emit` queues the notification id in `session.info`. An
  `after_commit` hook schedules `push.deliver` on the running loop, and a
  rollback drops the queue. There is no retry and no durable outbox, by design.
- **The server writes the push sentence** (`_PHRASES` in `services/push.py`),
  because the lock screen cannot run client code. This is a deliberate second
  copy of the wording in `packages/core/src/notifications.ts`. The two may
  differ in register but **never in meaning**. Update both together.
- `badge` carries the unread count *after* this notification.
- Push never raises into a producer. `DeviceNotRegistered` deletes the token
  (matched by ticket position). Other errors are logged.
- **The text matches in meaning but may say more:** a push quotes the comment,
  and an inbox row doesn't. A test checks that every `NotificationType` has a
  phrase.
- Configure with `PUSH_ENABLED` (on by default; an Expo token is itself the
  address, so no credential is needed) and an optional `EXPO_ACCESS_TOKEN`.

### Client side (`apps/mobile/src/lib/push.ts`, `push-bridge.tsx`)

- **Nothing in push may throw.** A declined permission, a simulator or Expo Go
  only makes the app slower to notice changes, never wrong about them, because
  the 60 s poll still runs.
- **Deregister *before* logout.** `forgetDevice` is an authenticated call, and
  `logout` destroys the token it needs (`app/settings/index.tsx`). The
  server's global-unique token is the second line of defence.
- **On native, opening a notification row marks it read.** Opening the tab
  still marks nothing.
- Receiving pushes needs a development or store build and an EAS project id.
  See [development](../architecture/development.md#mobile-on-a-device).

## Endpoints

`GET /notifications` · `GET /notifications/unread-count` ·
`POST /notifications/read` · `POST /users/me/devices` ·
`DELETE /users/me/devices/{token}`

## Code

- API: `app/services/{notifications,push,devices}.py`,
  `app/api/v1/{notifications,devices}.py`, `app/schemas/{notification,device}.py`
- Clients: `packages/core/src/notifications.ts`,
  `packages/core/src/notifications-store.tsx`, `apps/mobile/src/lib/push.ts`,
  `apps/mobile/src/components/push-bridge.tsx`
- Tests: `test_notifications.py`, `test_push.py`, `test_devices.py`

Related: [Notification and device tables](../models/notifications-and-devices.md) · [Conventions: side effects](../architecture/conventions.md#side-effects-ride-the-transaction)
