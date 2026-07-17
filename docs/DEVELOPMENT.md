# Development

## Environment

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./dev.db` locally; a Postgres URL in production |
| `SESSION_SECRET` | Signs session JWTs — 32 bytes base64 (`openssl rand -base64 32`) |
| `VAULT_MASTER_KEY` | Encrypts vault secrets — 32 bytes base64; KMS-managed in production |
| `META_APP_ID` / `META_APP_SECRET` | Meta developer app (Instagram + Facebook + Threads) |
| `META_REDIRECT_URI` | OAuth callback, `<origin>/api/oauth/meta/callback` |
| `OAUTH_MOCK` | `1` = simulate Meta grants (default until app review clears) |
| `TRUST_PROXY` | `1` only behind a proxy that sets `X-Forwarded-For` (audit IPs) |

## Database

Prisma with SQLite for zero-setup local dev. Production switches the
datasource provider to `postgresql` — the schema is written portably (no
enums; string state fields validated in the app layer).

```bash
npx prisma migrate dev      # apply migrations / create db
npx prisma studio           # inspect data
```

First-run `/setup` seeds demo accounts and posts (labeled `demo`) so every
screen renders populated before any real connection exists.

## Testing

```bash
npm run dev                 # integration tests need the server running
npm test                    # unit + integration (23 tests)
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

"Modernist": Archivo (400/600/800), blue `#2f54d1` primary with amber
`#f5a300` secondary, zero corner radius, 2 px rules, flush-left alignment.
Tokens live in `src/app/globals.css`; the platform/category/status color
lenses live in `src/lib/platforms.ts`.

## Platform app reviews

Developer-app submissions (Meta, X, LinkedIn, YouTube, TikTok, Pinterest,
Google Business) gate the integration timeline, not the code — start them
early. Until then `OAUTH_MOCK=1` keeps every flow exercisable.
