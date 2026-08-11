#!/bin/sh
# Container entrypoint: check the configuration, bring the schema up to date,
# then hand off.
#
#   docker run sidequestd-api                            # migrate, then serve
#   docker run sidequestd-api migrate                    # migrate and exit
#   docker run sidequestd-api python -m app.cli.trending # migrate, then one job
#   docker run -e RUN_MIGRATIONS=false sidequestd-api    # serve, no migration
set -eu

command="${1:-serve}"

# Check the configuration in this process, before anything else runs.
#
# `app.core.config` validates at import and raises on a production deploy that
# still holds a development default. Left to uvicorn that happens inside each
# worker, and the supervisor respawns them — so a misconfigured container spins
# in a crash loop that the orchestrator still reports as running, until the
# healthcheck eventually gives up. Importing here turns the same mistake into
# one legible message and a non-zero exit. It also runs ahead of the migration,
# so a bad deploy never reaches the database.
python - <<'PY' || exit 1
import sys

try:
    from app.core.config import settings
except Exception as exc:  # noqa: BLE001 - the message is the point
    print(f"==> configuration rejected\n{exc}", file=sys.stderr)
    raise SystemExit(1) from None

print(f"==> configuration ok (ENVIRONMENT={settings.environment})")
PY

# `upgrade head` on an already-current database is a no-op, so this is safe on
# every boot. It is *not* free of contention: several replicas starting at once
# each take Postgres' DDL locks, and they will serialise rather than race, but a
# long migration can hold the others in their start period. For a rollout with
# real downtime pressure, run `migrate` as its own job and start the replicas
# with RUN_MIGRATIONS=false.
#
# RUN_MIGRATIONS gates that implicit on-boot run only. An explicit `migrate`
# argument is a request to migrate and always does one, whatever the flag says:
# Fly runs its release_command on a machine that inherits the app's whole
# environment, RUN_MIGRATIONS=false included, so honouring the flag there would
# turn the single migration of a deploy into a silent no-op.
if [ "$command" = "migrate" ] || [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "==> alembic upgrade head"
    alembic upgrade head
fi

case "$command" in
    migrate)
        # The migration above was the whole job.
        exit 0
        ;;
    serve) ;;
    *)
        exec "$@"
        ;;
esac

# One worker per core plus one is the usual starting point for a mostly
# IO-bound service; the cap keeps a 64-core host from opening 129 database
# pools. Override with WEB_CONCURRENCY.
#
# Worth knowing before raising it: slowapi keeps its rate-limit counters in
# process memory, so N workers means each of them enforces the configured limit
# separately. See DEPLOY.md.
if [ -z "${WEB_CONCURRENCY:-}" ]; then
    cores="$(nproc 2>/dev/null || echo 1)"
    WEB_CONCURRENCY="$((2 * cores + 1))"
    [ "$WEB_CONCURRENCY" -gt 8 ] && WEB_CONCURRENCY=8
fi

# --proxy-headers with an explicit trusted-proxy list: without it the IP
# recorded against each refresh token, and the key every rate limit counts
# against, is the load balancer's rather than the client's. FORWARDED_ALLOW_IPS
# should name the proxy's address or CIDR; "*" trusts whatever sends the header,
# which is only safe when nothing but the proxy can reach this port.
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers "$WEB_CONCURRENCY" \
    --proxy-headers \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
    --no-server-header
