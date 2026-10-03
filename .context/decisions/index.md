---
type: index
title: "Decision Records"
description: "Map of archived, long-form decision records: plans and their rationale, kept verbatim as history."
tags: [index, decisions, history]
timestamp: 2026-10-03T21:25:55Z
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

Add a record here only for a decision too large for a log entry. Name the file
`YYYY-MM-<slug>.md` and give it `type: decision_log` frontmatter.
