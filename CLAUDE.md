# Sidequestd — agent instructions

A monorepo with a FastAPI API (`apps/api`), a Next.js web client (`apps/web`), an
Expo mobile client (`apps/mobile`), and shared packages (`packages/*`).

**`.context/` (the OKF knowledge bundle) is the single source of truth**: the
product spec, architecture, domain rules, schemas, setup, deployment and
roadmap. Code comments that cite `SPEC §x.y` refer to
`.context/product/spec.md`, and comments that cite `deployment.md §N` refer to
`.context/architecture/deployment.md`.

**No documentation markdown outside `.context/`.** The only exceptions are this
file and the root `README.md`, which is a brief overview. Do not create
`README.md`, `PLAN.md`, `NOTES.md` or similar files in apps or packages, and
do not add setup steps, design notes or status to the root README. Write it in
the bundle and link it from the nearest `index.md`. Plans and long-form
rationale go in `.context/decisions/`.

## Mandatory: knowledge-bundle upkeep

These rules apply to every coding session.

### 1. Pre-task discovery

Before adding or editing code, read `.context/index.md` and follow its links to
the relevant concept file(s) in `.context/architecture/`, `.context/domains/`
or `.context/models/`. Then read the code paths that file's `resource` field
and **Code** section point to.

### 2. Post-task documentation upkeep

Before you consider a task done:

- **Update the affected `.context/` file** if the change alters any of:
  - an **API contract**: a route, a request or response schema in
    `apps/api/app/schemas/`, a status code, or an enum value on the wire;
  - a **database schema**: a model in `apps/api/app/models/`, or an Alembic
    revision (also add it to the chain in `.context/models/index.md`);
  - a **core domain rule**: privacy, ownership, limits, ordering, notification
    triggers, or verification rules;
  - a **product requirement or status**: edit `.context/product/spec.md`
    (keep existing § numbers; add new subsections at the end) and
    `.context/product/roadmap.md` when a feature lands or a known limit is
    fixed;
  - **setup or tooling**: commands, env vars or generated files, in
    `.context/architecture/development.md`.
- **Bump the `timestamp`** frontmatter of every `.context/` file you modify to
  the current date and time in ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`).
- **Log the change** with a short entry at the top of `.context/log.md`
  (newest first, using the template in that file). Bump `log.md`'s own
  `timestamp` too.
- **Link new modules and schemas.** If you add a new domain module, table,
  enum or schema family, create its OKF file with the required frontmatter
  (`type`, `title`, `description`, `tags`, `timestamp`, `resource`) and add a
  relative link with a one-line summary to the nearest `.context/**/index.md`.

Purely internal refactors, styling and test-only changes do not need a log
entry unless they change one of the things above.

## Code conventions worth knowing up front

- Comments and docstrings explain **why**, not what. Many cite `SPEC §x.y`; keep
  those accurate. Do not add step-by-step narration.
- Types over prose: Pydantic models and type hints in the API (mypy `strict`),
  generated OpenAPI types on the clients (`@sidequestd/api-types`). Never
  redeclare an API shape by hand.
- Services raise `ServiceError` subclasses, never `HTTPException`.
- Any surface that shows user content must go through
  `content_is_visible_to` / `require_content_access` in
  `apps/api/app/services/users.py`.
- Client logic that would not differ on a phone belongs in `packages/core`,
  never copied into both apps.

## Commands

```bash
npm run infra:up       # Postgres, MinIO, Mailpit
npm run api:dev        # API on :8000      | npm run web:dev  # web on :3000
npm run api:test       # pytest (needs Postgres running)
npm run web:test       # vitest
npm run lint           # tokens + brand checks, ruff, mypy, eslint
npm run gen:types      # after any API schema change
cd apps/mobile && npm run typecheck && npm run lint   # mobile is outside the workspace
```
