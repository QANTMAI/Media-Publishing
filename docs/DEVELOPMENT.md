# Development

## Environment

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file in every environment (`file:./dev.db` locally; a persistent path in prod) |
| `SESSION_SECRET` | Signs session JWTs — 32 bytes base64 (`openssl rand -base64 32`) |
| `VAULT_MASTER_KEY` | Encrypts vault secrets — 32 bytes base64; KMS-managed in production |
| `META_APP_ID` / `META_APP_SECRET` | Meta developer app (Instagram + Facebook + Threads) |
| `META_REDIRECT_URI` | OAuth callback, `<origin>/api/oauth/meta/callback` |
| `OAUTH_MOCK` | `1` = simulate Meta grants (default until app review clears) |
| `TRUST_PROXY` | `1` only behind a proxy that sets `X-Forwarded-For` (audit IPs) |
| `STORAGE_DIR` | Private media directory for the local storage adapter |
| `STORAGE_SIGNING_KEY` | Signs media URLs — 32 bytes base64 |
| `PUBLIC_ORIGIN` | Public app origin; required for real Instagram media publishing |
| `SMTP_URL` / `SMTP_FROM` | Optional; set both to enable email notifications (else in-app only) |
| `AUTH_DEV_BYPASS` | `1` enables the dev-only 2FA bypass (non-production only) |

A config guard (`src/lib/server/config.ts`) validates these at boot and, in
production, aborts the start on any critical miss (missing vault key, dev
bypass left on, etc.).

## Database

Prisma with SQLite in **every** environment — dev, test, and production
(single-operator by design). Zero-setup locally; in prod the file lives on a
persistent volume in WAL mode with Litestream streaming backups (see
[DEPLOYMENT.md](DEPLOYMENT.md)). WAL is enabled automatically at boot. The
schema is written portably (no enums; string state fields validated in the app
layer) so a future move to Postgres stays low-friction.

```bash
npx prisma migrate dev      # apply migrations / create db
npx prisma studio           # inspect data
```

First-run `/setup` seeds demo accounts and posts (labeled `demo`) so every
screen renders populated before any real connection exists.

## Testing

```bash
npm run dev                 # integration tests need the server running
npm test                    # unit + integration (full suite)
npm run test:unit           # unit only (timezone, vault, backoff, rules)
```

Integration tests sign in through the real flow — password, then a TOTP code
computed from the enrolled secret (exactly what an authenticator app does) —
and exercise scheduling, validation, the queue/worker, kill switch,
reschedule/cancel semantics, TOTP replay rejection, and autopilot. Test
credentials default to the local dev operator; override with `TEST_EMAIL`,
`TEST_PASSWORD`, `TEST_BASE_URL`.

## Project layout

```
src/
  app/                  # routes (App Router)
    (portal)/           # authed app: dashboard, compose, calendar, library,
                        #   analytics, accounts
    login/  setup/      # auth gate + first-run TOTP enrollment
    api/                # auth, accounts, posts, targets, settings,
                        #   autopilot, oauth/meta
  components/           # shared UI (Toast, PostDialog, AuthPoster)
  lib/
    platforms.ts        # platform rules engine (editable config) + colors
    store.ts            # zustand client cache + composer/view preferences
    server/             # db, session, vault, audit, timezone, rate-limit,
                        #   meta, publisher, worker, settings, seed-accounts
  instrumentation.ts    # boots the publish worker in the server process
prisma/                 # schema + migrations
tests/                  # unit + integration suites
docs/                   # this documentation
```

## Design system

Two layers in `src/app/globals.css`:
- **Modernist base** — Archivo, blue `#2f54d1` + amber `#f5a300`, zero
  radius, 2 px rules (the original handoff spec).
- **"Liquid Glass" skin** (active) — the design prototype's skin layer:
  Apple-blue `#0a84ff`, SF Pro stack, white cards with 1 px hairlines and
  12–18 px radii, translucent blurred sidebar/top bar, soft gradient ground,
  pill tags/toasts, and specular edge highlights. Remove the skin block
  to fall back to flat Modernist.
- **Refraction ("lensing")** — real edge light-bending via an SVG
  `feDisplacementMap` through `backdrop-filter` (`GlassFilters.tsx`).
  Progressive enhancement only: enabled via the `glass-lens` class on
  `<html>` solely in engines verified to render it (Blink) and only when
  the user hasn't requested reduced transparency/motion. The base glass
  is always present, so where refraction is unsupported nothing is lost.
  Applied to the sidebar + panels (static backdrops), deliberately NOT
  the sticky top bar (content scrolls under it every frame — the one
  per-frame-recompute case we avoid for scroll performance).

The platform/category/status color lenses live in `src/lib/platforms.ts`.

## Platform app reviews

Developer-app submissions (Meta, X, LinkedIn, YouTube, TikTok, Pinterest,
Google Business) gate the integration timeline, not the code — start them
early. Until then `OAUTH_MOCK=1` keeps every flow exercisable.

## Recovery & operational safety

**First-run window (TOFU):** until setup completes, `/setup` is open to
whoever reaches the port — run first-run setup **before** exposing the portal
to any network.

**Lost password or authenticator:** there is no self-service reset (single
operator, no email infrastructure). Recovery is a documented DB operation on
the host:

```bash
# Reset 2FA enrollment — forces /setup to re-run with a fresh QR. Completing
# setup REPLACES the operator row, which cascades accounts/posts/assets;
# demo rows re-seed automatically, but real connections/posts are lost.
npx prisma db execute --stdin <<< "UPDATE User SET totpEnabled = 0;"
```

After that, restart the server and complete /setup again. Sessions can be
force-revoked at any time by bumping the epoch:
`npx prisma db execute --stdin <<< "UPDATE Setting SET value = CAST((CAST(value AS INTEGER)+1) AS TEXT) WHERE key='sessionEpoch';"`

**Backups:** dev = copy the SQLite file (+ the `storage/` directory) while the
server is stopped. Prod = **Litestream** streams the WAL to object storage
continuously (see [DEPLOYMENT.md](DEPLOYMENT.md)). Either way, the vault's
encrypted tokens are only readable with `VAULT_MASTER_KEY` — back the key up
separately and securely, or a restored database has unreadable credentials.

**Disk sizing:** uploads stream to the `storage/` volume (≤512 MB per video,
25 MB per image; presign is rate-limited to 60/h and byte caps are signed
into upload URLs). Abandoned uploads are swept hourly after a 24 h grace.
Keep the storage volume separate from the database volume in production so
a full media disk cannot take the DB down; alert at 80 % usage.

**Shutdown behavior:** in-flight transcodes/publishes at crash time are
recovered by stale-claim reclaim (publish jobs ~10 min, transcodes ~45 min).
A crashed transcode may leave a `qantm-transcode-*` directory in the OS temp
dir — harmless, OS-cleaned.
