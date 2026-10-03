---
type: schema_definition
title: "Users and Auth Tables"
description: "users, favorite_games, refresh_tokens and password_reset_tokens: columns, constraints and invariants."
tags: [models, users, auth, tokens, favorites]
timestamp: 2026-10-03T00:00:00Z
resource: apps/api/app/models/user.py
---

# Users and auth tables

## `users` (`models/user.py`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `username` | varchar(30), unique | stored lower-case; at least 3 characters; `^[a-zA-Z0-9._]+$` validated in `schemas/user.py` |
| `email` | varchar(320), unique | stored lower-case; private, never shown on profiles |
| `hashed_password` | varchar(255) | argon2id; not part of **any** response schema |
| `display_name` | varchar(50) null | |
| `bio` | varchar(300) null | |
| `avatar_url` | text null | |
| `is_private` | bool, default false | drives the [privacy gate](../domains/profiles-and-privacy.md) |
| `is_active` | bool, default true | deactivated accounts drop out of feeds |
| `email_verified_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | DB clock |

Checks: `username_is_lowercase`, `email_is_lowercase`, `username_min_length`.
GIN trigram indexes on `username` and `display_name` serve user search.

## `favorite_games`

Composite PK `(user_id, game_id)`, plus `position` (≥ 0, kept dense in the
service). The maximum of 6 is enforced in the service (`MAX_FAVORITE_GAMES`),
not in the database.

## `refresh_tokens` (`models/auth.py`)

`token_hash` (SHA-256, unique), `family_id` (one per login), `expires_at`,
`revoked_at`, `replaced_by_id` (a self-FK that chains rotations), and
`user_agent` / `ip_address` for a future sessions screen. A token is active
when it is not revoked and not expired.

## `password_reset_tokens`

`token_hash` (unique), `expires_at` (60 min), `used_at`. Single use; issuing a
new token invalidates any older outstanding ones.

All of these tables cascade on user delete.

Related: [Auth and sessions](../domains/auth-and-sessions.md) · [Profiles and privacy](../domains/profiles-and-privacy.md)
