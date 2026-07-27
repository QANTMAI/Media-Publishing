# syntax=docker/dockerfile:1
#
# Production image for the QANTM Media Publishing Portal.
#
# Design decisions (all grounded in how this app actually runs):
#  - Debian slim (glibc), not Alpine: sharp / ffmpeg-static / ffprobe-static
#    resolve prebuilt glibc binaries; musl would need extra work.
#  - NOT Next "standalone" output: those three packages are kept external
#    (serverExternalPackages in next.config.mjs) and resolve binaries via
#    __dirname, which standalone file-tracing can drop. We ship the real
#    node_modules and run `next start` — larger, but correct.
#  - The publish worker boots in-process via src/instrumentation.ts, so a
#    single `next start` runs both the HTTP server and the worker.
#  - SQLite lives on a mounted volume at /app/data. Migrations are applied at
#    container start (prisma migrate deploy), never at build.
#  - No secrets are baked in. SESSION_SECRET / VAULT_MASTER_KEY /
#    STORAGE_SIGNING_KEY / DATABASE_URL are supplied by the host at RUN time.
#
# Durability: SQLite on a single volume is not a backup. Configure Litestream
# (docs/DEPLOYMENT.md) and set DB_BACKUP_CONFIGURED=1 before real use.

# ── Stage 1: install deps + build ──────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

# Throwaway build-time env — NEVER real secrets. This stage is discarded, so
# these values never reach the final image. They exist only so any config read
# during `next build`'s static generation has something well-formed to parse;
# the app reads real secrets lazily at runtime, not at build.
ENV SESSION_SECRET="build-only-placeholder-not-a-real-secret-000" \
    VAULT_MASTER_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    STORAGE_SIGNING_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    DATABASE_URL="file:./build.db"
RUN npx next build

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    # SQLite on the mounted volume. Absolute path so Prisma resolves it the
    # same regardless of CWD. Mount a persistent volume at /app/data.
    DATABASE_URL="file:/app/data/prod.db"

# Non-root runtime user; owns the app and the data volume mount point.
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /app/data && chown -R app:app /app

# Copy the built app + the exact node_modules the build produced (native
# binaries already in place). Ownership set to the runtime user.
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/docker-entrypoint.sh ./docker-entrypoint.sh

USER app
VOLUME ["/app/data"]
EXPOSE 3000

# Applies migrations, then starts Next (which also boots the in-process worker).
ENTRYPOINT ["./docker-entrypoint.sh"]
