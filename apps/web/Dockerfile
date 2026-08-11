# syntax=docker/dockerfile:1

# Production image for the Sidequestd web client. The build context is the
# REPO ROOT, not apps/web — this is an npm workspace, so the lockfile and
# packages/api-types both live above the app:
#
#     docker build -f apps/web/Dockerfile \
#       --build-arg NEXT_PUBLIC_API_URL=https://api.sidequestd.app \
#       --build-arg NEXT_PUBLIC_MEDIA_URL=https://media.sidequestd.app \
#       -t sidequestd-web .
#
# Both build args are inlined into the client bundle (see next.config.ts), so
# the image is tied to the API and media hosts it was built against. Pointing at
# different ones means a rebuild, not a restart. See DEPLOY.md.

# --- deps ------------------------------------------------------------------
# Only the manifests, so this layer is reused until a dependency actually
# changes.
FROM node:22-bookworm-slim AS deps
WORKDIR /srv

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/api-types/package.json packages/api-types/

RUN --mount=type=cache,target=/root/.npm npm ci

# --- builder ---------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /srv

# The whole installed tree, symlinked workspace entries included — npm hoists to
# the root but may leave a nested node_modules behind, and taking all of it
# avoids guessing which. The source COPYs below merge into it rather than
# replacing it.
COPY --from=deps /srv ./
COPY packages/api-types ./packages/api-types
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
# The public base URL of the media bucket or CDN, matching the API's
# S3_PUBLIC_URL_BASE. Empty means the development MinIO container, which
# next.config.ts already allow-lists.
ARG NEXT_PUBLIC_MEDIA_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build --workspace @sidequestd/web

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# curl is here for HEALTHCHECK only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /srv

# The standalone bundle keeps the workspace layout, so server.js lands under
# apps/web/. Static assets are not traced into it and have to come across
# separately. The node images already ship an unprivileged `node` user.
COPY --from=builder --chown=node:node /srv/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /srv/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

# Next has no dedicated health route; the landing page is static and cheap.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["node", "apps/web/server.js"]
