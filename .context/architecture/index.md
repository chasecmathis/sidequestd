---
type: index
title: "Architecture"
description: "Map of the system-architecture documents: stack, local development, deployment, mobile client, shared packages, repository layout, and cross-cutting conventions."
tags: [index, architecture]
timestamp: 2026-10-03T21:25:55Z
resource: ./
---

# Architecture

| Document | Summary |
| --- | --- |
| [Stack](stack.md) | Runtimes, frameworks and infrastructure for each app, plus the scheduled jobs and CLI commands. |
| [Local development](development.md) | Prerequisites, running the stack, tests, loading the catalog, and regenerating types, tokens and brand assets. |
| [Deployment](deployment.md) | The production runbook: environment, manual deploy, HTTPS switches, post-deploy checks, CI/CD on Fly.io, rollbacks and scheduled jobs (the former `DEPLOY.md`, § numbers kept). |
| [Mobile client](mobile-client.md) | Expo app wiring, screen-writing rules, design-system translation, deliberate divergences from the web, failure screens and accessibility. |
| [Shared packages](shared-packages.md) | `@sidequestd/core` (and its three platform seams), `api-types` and `design-tokens`. |
| [Folder structure](folder-structure.md) | Where things live in the monorepo, and why `apps/mobile` sits outside the npm workspace. |
| [Conventions](conventions.md) | Rules that cut across every slice: router/service/model layering, the privacy gate, keyset pagination, domain errors, transactional side effects, OpenAPI type generation and shared client code. |

Related: [Domains](../domains/index.md) · [Models](../models/index.md)
