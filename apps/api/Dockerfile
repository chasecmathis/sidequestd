# syntax=docker/dockerfile:1

# Production image for the Sidequestd API. Build context is apps/api:
#
#     docker build -t sidequestd-api apps/api
#
# See .context/architecture/deployment.md at the repo root for the environment it expects.

# --- builder ---------------------------------------------------------------
# uv resolves from the committed lockfile into a self-contained .venv, which the
# runtime stage copies wholesale. Nothing from this stage — not uv, not a
# compiler, not the build cache — reaches the shipped image.
FROM python:3.12-slim-bookworm AS builder

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/srv/.venv

WORKDIR /srv

# Dependencies before application code: they change far less often, so this
# layer survives most rebuilds. `--no-dev` leaves pytest, ruff and mypy out.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY app ./app
COPY migrations ./migrations
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- runtime ---------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# curl is here for HEALTHCHECK and nothing else; the app makes its outbound
# calls through httpx.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 sidequestd \
 && useradd --system --uid 1001 --gid sidequestd --home-dir /srv --shell /usr/sbin/nologin sidequestd

ENV PATH="/srv/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

WORKDIR /srv
COPY --from=builder --chown=sidequestd:sidequestd /srv /srv
COPY --chown=sidequestd:sidequestd docker-entrypoint.sh /usr/local/bin/sidequestd-entrypoint
RUN chmod +x /usr/local/bin/sidequestd-entrypoint

USER sidequestd
EXPOSE 8000

# Hits the same GET /health the load balancer should use. `start-period` covers
# the Alembic run the entrypoint does before the server binds.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

# The entrypoint runs `alembic upgrade head`, then execs this.
ENTRYPOINT ["sidequestd-entrypoint"]
CMD ["serve"]
