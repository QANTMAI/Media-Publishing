#!/bin/sh
# Container entrypoint: fail fast on a missing real secret, apply pending
# migrations, then start the server (which boots the in-process publish worker
# via src/instrumentation.ts). `exec` so Next is PID 1's child and receives
# SIGTERM for graceful shutdown.
set -e

for var in SESSION_SECRET VAULT_MASTER_KEY STORAGE_SIGNING_KEY; do
  eval "val=\${$var}"
  if [ -z "$val" ] || echo "$val" | grep -q "build-only-placeholder"; then
    echo "[entrypoint] FATAL: $var is not set to a real value. Provide it via the host's secret store (see docs/DEPLOYMENT.md)." >&2
    exit 1
  fi
done

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] starting server + worker on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}…"
exec node_modules/.bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
