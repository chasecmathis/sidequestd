# @sidequestd/api-types

TypeScript types for the Sidequestd API, shared by the web and mobile clients.

`src/schema.d.ts` and `openapi.json` are **generated** — do not edit them. The
Python service is the single source of truth. After changing any endpoint or
schema in `apps/api`, regenerate from the repo root:

```bash
npm run gen:types
```

That exports FastAPI's OpenAPI document to `openapi.json` (no database needed)
and runs `openapi-typescript` over it. Commit both files so a fresh checkout can
typecheck without a Python toolchain.

`src/index.ts` is hand-written and holds the friendly aliases the clients import
(`UserMe`, `AuthSession`, …), so a rename upstream shows up as a type error here
rather than silently drifting.
