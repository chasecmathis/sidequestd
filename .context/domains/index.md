---
type: index
title: "Domains"
description: "Map of the product domains, with each one's load-bearing rules, endpoints and code locations."
tags: [index, domains]
timestamp: 2026-10-03T21:25:55Z
resource: apps/api/app/services/
---

# Domains

Each file covers one product area: what it is, the rules that must keep holding,
its endpoints (all under `/api/v1`), and where the code lives in the API and in
both clients.

| Domain | Summary | SPEC |
| --- | --- | --- |
| [Auth and sessions](auth-and-sessions.md) | Registration, login, rotating refresh tokens with reuse detection, password reset, and token delivery to web and native clients. | §6.1, §9 |
| [Profiles and privacy](profiles-and-privacy.md) | Profiles, favorites, stats, follower lists, and the single privacy gate every content surface goes through. | §6.2, §6.7, §6.8 |
| [Social graph](social-graph.md) | Follow and unfollow, follow requests for private accounts, approval and removal. | §6.7 |
| [Reviews and media](reviews-and-media.md) | One review per user per game, the half-star rating scale, and the photo and clip upload and processing pipeline. | §6.3, §9 |
| [Interactions](interactions.md) | Likes and one-level threaded comments, gated by the review author's privacy. | §6.10 |
| [Home feed](feed.md) | A unified feed of followed reviews, backlog activity and a capped recommended blend under one cursor. | §6.4, §6.11 |
| [Discovery](discovery.md) | Catalog import from IGDB, browse and facets, search, trending and personalised recommendations. | §2, §6.5, §6.6, §6.11 |
| [Backlog](backlog.md) | Four status lists stored as one table, dense ordering, and status changes as feed events. | §6.9 |
| [Notifications and push](notifications-and-push.md) | In-app inbox written through `emit`, plus Expo push dispatched after commit. | §6.12 |
| [Documents](documents.md) | About, privacy policy and terms: shared words in `core`, claims pinned by tests, per-client renderers. | §6.13 |
| [Platform connections](platform-connections.md) | Steam linking through OpenID 2.0, library sync, and the verified playtime badge. | §6.13 |

Data shapes for each domain are in [Models](../models/index.md). Rules shared by
every domain are in [Conventions](../architecture/conventions.md).
