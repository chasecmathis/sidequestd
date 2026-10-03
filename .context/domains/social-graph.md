---
type: domain_concept
title: "Social Graph"
description: "Directed follow edges, follow requests for private accounts, approval, decline and follower removal."
tags: [domain, social, follows, privacy]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/social.py
---

# Social graph

## Rules that must keep holding

- **A public account is followed; a private account is asked.** The target's
  `is_private` at the moment of the request decides between an ACCEPTED edge
  and a PENDING one. The follower does not choose.
- **Approval belongs to the followee.** Only the followee may accept, decline
  or remove a follower. The follower may only create or withdraw their own edge;
  `DELETE /follow/{id}` both cancels a pending request and unfollows.
- **Switching an account to public does not auto-approve pending requests.**
  If the follower repeats the request after the switch, the edge becomes ACCEPTED.
- **One row, owned by the follower.** `POST /follow/{id}` creates it.
  `DELETE /follow/{id}` removes it, whether it is a follow or an unanswered
  request.
- **Follow is idempotent.** Following someone you already follow reports your
  current state instead of failing. The response includes the followee's
  `follower_count`, so the number next to the button updates without a second
  request.
- **Declining is silent** and leaves no record. Nothing notifies the requester,
  whose button falls back to "Follow", and they may ask again.
- **`responded_at` means somebody answered.** It stays null for an instant
  follow of a public account.
- **No self-follows** (a check constraint enforces this).
- The **viewer's standing** with a profile arrives on that profile as
  `viewer_follow_state` (`NONE` / `REQUESTED` / `FOLLOWING`). This value is
  derived, never stored.
- Writes live here and reads live in `services/users.py`. Accepting an edge
  unlocks content everywhere through the [privacy gate](profiles-and-privacy.md).

## Notifications produced

`FOLLOW_REQUEST`, `NEW_FOLLOWER`, `FOLLOW_REQUEST_APPROVED`, all through
`notifications.emit`.

## Endpoints

`GET /follow/requests` · `POST /follow/requests/{user_id}/accept` ·
`POST /follow/requests/{user_id}/decline` · `POST /follow/{user_id}` ·
`DELETE /follow/{user_id}` · `DELETE /followers/{user_id}`

`/follow/requests…` must stay declared before `/follow/{user_id}`.

## Code

- API: `app/api/v1/social.py`, `app/services/social.py`, `app/schemas/social.py`
- Clients: `packages/core/src/social.ts` (button state → request),
  `follow-button.tsx` and `follow-requests` in both apps
- Tests: `test_social_follow.py`, `test_social_requests.py`, `test_users_follows.py`

Related: [Social tables](../models/social-and-backlog.md) · [Notifications and push](notifications-and-push.md)
