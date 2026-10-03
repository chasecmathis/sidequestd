---
type: domain_concept
title: "Documents: About, Privacy Policy, Terms"
description: "The long-form documents both clients show, why their words live in @sidequestd/core, the claims tests pin, and how each client renders them."
tags: [domain, documents, privacy, legal, prose, about]
timestamp: 2026-10-03T21:25:55Z
resource: packages/core/src/policy.ts
---

# Documents: About, privacy policy and terms

These are the only screens that are documents rather than interfaces, and the
only copy that neither client may own. Two clients disagreeing about a
presentation rule is an inconsistency. Two clients disagreeing about a privacy
policy means one of them is **wrong**, which is why the words are shared.

## Where the words live (`packages/core/src/`)

| File | Holds |
| --- | --- |
| `prose.ts` | The block model (`heading`, `paragraph`, `list`, flat `Inline` runs) and builders (`h2`, `p`, `b`, `a`, `mail`). It contains no markup, so it stays within core's no-rendering rule. |
| `policy.ts` | The privacy policy and terms, plus notes on what must stay true in them |
| `about.ts` | Five named sections. Both clients say the same sentences and each arranges them its own way |
| `site.ts` | Product-wide strings such as the contact address |
| `policy.test.ts` | Pins claims that **another file** could falsify: camera metadata is stripped (the API media pipeline), personal information isn't sold or shared, no infrastructure vendors are named, the push service is disclosed, account deletion is explained, the DMCA §512 procedure is present, and terms §§1–7 keep their numbers. Also checks that documents link only to destinations both clients can reach. |

**When a change affects what a policy claims** (data collected, metadata
handling, third parties), update `policy.ts` and its test in the same change.

## Rendering

Each client has its own renderer: `apps/web/src/components/prose.tsx`
(`prose-legal` styles) and `apps/mobile/src/components/prose.tsx`. The native
renderer has to do four things CSS gives the web for free: nest emphasis (each
weight is a font family), draw bullets, space blocks, and decide what a link
does. `linkKind` in core is the shared rule. On native, `mailto:` opens the
mail app, an external link opens a browser over the app, and an in-app path
pushes a screen. Links are always underlined on native. `em` and `strong`
render the same there, deliberately, to avoid shipping a sans italic for one
sentence.

## Reachability

All three are **readable signed out**, because people read a privacy policy
before deciding to sign up, and the app stores require it. The web links them
from a footer on every page. Mobile puts them in a second group on the
Settings stack.

Related: [Shared packages](../architecture/shared-packages.md) · [Reviews and media](reviews-and-media.md)
