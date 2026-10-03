---
type: index
title: "Product"
description: "Map of the product documents: the specification that code cites as SPEC §x.y, and the live status and roadmap."
tags: [index, product, spec, roadmap]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Product

| Document | Summary |
| --- | --- |
| [Specification (SPEC)](spec.md) | Vision, personas, screen map, functional and non-functional requirements, and scope. Code comments cite it as `SPEC §x.y`, and the section numbers are stable. Each section has an "As built" note where the code differs. |
| [Status and roadmap](roadmap.md) | What is built, what the spec asks for that is not, known limits to fix before scaling, and candidate next work. |

**Changing a requirement?** Edit `spec.md` in the same change as the code, keep
the existing § numbers (add new subsections at the end, e.g. §6.14), and log it
in [log.md](../log.md).

Related: [Domains](../domains/index.md) · [Architecture](../architecture/index.md)
