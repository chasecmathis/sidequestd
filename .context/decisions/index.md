---
type: index
title: "Decision Records"
description: "Map of archived, long-form decision records: plans and their rationale, kept verbatim as history."
tags: [index, decisions, history]
timestamp: 2026-10-04T03:26:35Z
resource: ./
---

# Decision records

Long-form records of *why* something was built the way it was, kept verbatim
as history. They describe a moment in time, not the current state. Current
behaviour lives in [Architecture](../architecture/index.md),
[Domains](../domains/index.md) and [Models](../models/index.md). Short entries
for individual changes go in [log.md](../log.md).

| Record | Summary |
| --- | --- |
| [Mobile port plan (2026-08)](2026-08-mobile-port-plan.md) | The eight-phase plan for building the Expo client at parity with the web: the `core`/`design-tokens` extraction, platform seams, the native design-system translation, and the deviations each phase made from the plan. |
| [Search relevance (2026-10)](2026-10-search-relevance.md) | Built (`5d2e8b4c9a17`): typo-, accent- and word-order-tolerant game search with IGDB aliases and popularity ranking, follow-graph-aware user search, and a shared `useSearch` hook in `packages/core`. Postgres-native (`pg_trgm` + `unaccent`) over a dedicated engine. |
| [Search relevance plan (2026-10)](2026-10-search-relevance-plan.md) | The task-by-task implementation plan for the record above, with the research findings that refined it. |

Add a record here only for a decision too large for a log entry. Name the file
`YYYY-MM-<slug>.md` and give it `type: decision_log` frontmatter.
