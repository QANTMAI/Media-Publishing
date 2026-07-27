#!/bin/sh
# Container entrypoint. Starts as root so it can make a freshly-mounted
# persistent disk writable by the non-root app user (Render/k8s mount disks
# root-owned), then verifies real secrets, applies pending migrations, and
# starts the server (which boots the in-process publish worker via
# src/instrumentation.ts). `exec gosu` so Next replaces the shell and receives
# SIGTERM for graceful shutdown.
set -e

DATA_DIR="/app/data"
mkdir -p "$DATA_DIR"
# No-op when already app-owned (e.g. a Docker named volume); the real work is
# on hosts that mount the disk root-owned.
chown -R app:app "$DATA_DIR" 2>/dev/null || true

for var in SESSION_SECRET VAULT_MASTER_KEY STORAGE_SIGNING_KEY; do
  eval "val=\${$var}"
  if [ -z "$val" ] || echo "$val" | grep -q "build-only-placeholder"; then
    echo "[entrypoint] FATAL: $var is not set to a real value. Provide it via the host's secret store (see docs/DEPLOYMENT.md)." >&2
    exit 1
  fi
done

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
gosu app node_modules/.bin/prisma migrate deploy

echo "[entrypoint] starting server + worker on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}…"
exec gosu app node_modules/.bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
