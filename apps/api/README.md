# Sidequestd API

FastAPI service backing both the web and mobile clients (SPEC §2).

See the [root README](../../README.md) for full local setup. Quick reference:

```bash
uv sync --all-extras          # install
uv run alembic upgrade head   # migrate
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                 # tests (needs the Postgres container running)
uv run ruff check . && uv run mypy app
```

## Layout

| Path              | Contents                                                      |
| ----------------- | ------------------------------------------------------------- |
| `app/core/`       | Settings, password hashing, JWT + opaque token helpers, email |
| `app/db/`         | Declarative base, mixins, async engine and session dependency |
| `app/models/`     | SQLAlchemy models for the whole SPEC §7 schema                |
| `app/schemas/`    | Pydantic request/response models                              |
| `app/api/`        | Routers and dependencies, mounted under `/api/v1`             |
| `app/services/`   | Business logic that endpoints delegate to                     |
| `migrations/`     | Alembic environment and versions                              |
| `tests/`          | pytest suite, run against a real Postgres database            |

## Implemented so far

Slice 1 — authentication and onboarding only (SPEC §6.1). Every other table from
SPEC §7 exists in the schema but has no endpoints yet.
