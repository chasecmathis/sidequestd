---
type: domain_concept
title: "Status, Known Limits and Roadmap"
description: "What is built, what the spec asks for that is not, the known limits to fix before scaling, and candidate next work."
tags: [product, status, roadmap, limits, todo]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Status, known limits and roadmap

This is the live record of what has landed. It replaces the former README
"Status", "Before deploying anywhere real" and "Next slices" sections. Update it
whenever a slice lands or a limit is fixed.

## Built

The MVP surface of the [spec](spec.md) (§10) plus several fast-follows:
auth and sessions, profiles with favorites and stats, catalog, browse,
Discover and search, reviews with photo and clip media, the follow graph with
private-account approval, likes and comments, the unified Home feed (followed
reviews, backlog activity and a recommended blend), the four backlog lists,
in-app notifications with Expo push, personalised recommendations, Steam
linking with verified playtime, the About, privacy and terms pages, and light
and dark themes. Both the web client and the native client cover all of it.

## Specified but not built

| Item | SPEC |
| --- | --- |
| First-run onboarding (pick genres, games, accounts) | §6.1 |
| Recent and trending searches | §6.6 |
| Blocking | §6.7, §10 |
| Settings: change username, email or password; delete account; notification categories; preferences | §6.13, §9 |
| Moderation: reporting, blocklist, admin removal | §9 |
| Video transcoding and poster frames; virus scanning; CDN with expiring URLs | §6.3, §9 |
| Rate limiting on general write endpoints (only auth, reset and search are limited) | §9 |
| Observability: error tracking and analytics events | §9 |
| Custom lists, per-list privacy, social OAuth login | §10 |

**DMs** were listed as a next slice in the old README, but no section of the
spec describes them. Write the requirements into [spec.md](spec.md) before
building them.

## Known limits (fix before scaling)

- **Rate limits are per process.** slowapi keeps its counters in memory, so
  N uvicorn workers × M replicas each enforce the limit separately: a
  `10/minute` login limit is really `10 × N × M`. Set `WEB_CONCURRENCY=1` if
  that matters more than throughput, or point slowapi at Redis.
- **Media processing runs in-process** on FastAPI background tasks, and a
  100 MB clip is read fully into memory on its way to the bucket. A restart
  drops in-flight work until `app.cli.process_media` runs, and that command has
  no schedule yet. Size container memory for `WEB_CONCURRENCY` concurrent
  uploads, and move processing behind a queue before uploads get heavy.
- **Trending has flat weights with no recency decay** (`TODO(trending worker)`
  in `app/services/trending.py`). An event on day 1 counts the same as one on
  day 7. Tune it against real traffic.
- **Proxy headers:** set `FORWARDED_ALLOW_IPS` to the load balancer, or the IP
  recorded against refresh tokens will be the balancer's.
- **`pg_trgm`:** the search migration runs `CREATE EXTENSION IF NOT EXISTS
  pg_trgm`, which needs CREATE on the database. If migrations run as a
  restricted role, have a DBA install the extension once first.
- **Production boot guard:** with `ENVIRONMENT` set to `staging` or
  `production`, the API refuses to start while any secret, CORS, cookie, SMTP
  or S3 setting is still at its dev default, and it lists all of them at once.
  This is intended behaviour. [Deployment](../architecture/deployment.md) §1
  explains each setting.

Related: [Spec](spec.md) · [Stack](../architecture/stack.md) · [Log](../log.md)
