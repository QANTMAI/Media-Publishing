# QANTM Media — Publishing Portal

A secure, single-operator web portal to compose, schedule, and auto-publish
social content across ten platforms — Instagram, Facebook, X, LinkedIn,
YouTube, TikTok, Threads, Bluesky, Pinterest, and Google Business — from one
calendar.

Built security-first: mandatory TOTP two-factor auth, an AES-256-GCM encrypted
credential vault, a durable publish queue with retries, and a full audit log.

## Features

- **Compose once, publish everywhere** — one base caption, per-platform
  overrides, live per-platform validation (character limits, media rules),
  and a live post preview.
- **Multiple accounts per platform** — connect any number of profiles per
  network; every post targets specific accounts, not just "the platform".
- **Visual calendar** — Month / Week / List views (FullCalendar, MIT),
  drag-to-reschedule, color lenses by category, platform, or status.
- **Reliable auto-publishing** — a durable job queue publishes at the
  scheduled time with exponential-backoff retries; failures surface with the
  platform's actual error. A kill switch pauses everything instantly.
- **Autopilot** — plans a week of posts across connected accounts; a delivery
  mode (hold-for-review vs auto-schedule) routes drafts to the review inbox or
  straight to the calendar. Turning it off cleanly removes unpublished plans.
- **Real platform integrations** — Meta (Instagram + Facebook) and LinkedIn
  OAuth + publishing are built against the platforms' current APIs; every
  other platform runs in clearly-labeled mock mode until its app is configured.
- **Settings** — Autopilot mode, editable content categories (create / rename /
  recolor / delete), encrypted API-key vault (Anthropic), RSS **trend sources**,
  and per-event notification preferences.
- **Notifications** — an in-app bell driven by real events (publish failures,
  review-ready drafts), with an optional email mirror.
- **Trending & breaking** — the composer surfaces items from your own RSS/Atom
  feeds; "Draft a post" seeds the composer from an item.
- **Dashboard** — weekly goal tracking and honest metrics: real numbers where a
  platform is connected, an explicit "connect analytics" state otherwise (never
  fabricated).

## Quick start

```bash
npm install
npx prisma migrate dev   # creates the local SQLite database
npm run dev              # http://localhost:3000
```

First run opens **/setup**: create the operator account, scan the TOTP QR
with an authenticator app, and confirm a code. Sign-in from then on is
email + password + TOTP.

Copy `.env.example` to `.env` and fill in the secrets (32-byte base64 values
for `SESSION_SECRET` and `VAULT_MASTER_KEY`, e.g. `openssl rand -base64 32`).
With no Meta app credentials configured, OAuth connects run in a clearly
labeled mock mode so the whole pipeline works before platform app review.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (also boots the publish worker) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Full test suite (unit + integration; dev server must be running) |
| `npm run test:unit` | Unit tests only |

## Stack

Next.js 15 (App Router) · TypeScript · Prisma + SQLite (WAL; Litestream backups
in prod) · zustand · FullCalendar · jose · otplib · bcryptjs

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design: data model,
  publish queue, credential vault, auth flow.
- [docs/DATA-MAP.md](docs/DATA-MAP.md) — the taxonomy & legend, data sources,
  signal-ingestion paths, the audit-action registry, and the system rules.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — environment, database,
  testing, recovery/backups, and platform-integration notes.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production checklist: secrets, the
  SQLite + WAL + Litestream setup, config guard, health probe, security.
- [docs/PLATFORM-RULES.md](docs/PLATFORM-RULES.md) — every platform limit,
  its verification status, and the single-source-of-truth rule.
- [docs/VIDEO.md](docs/VIDEO.md) — researched video specs and the encode plan.

## Status

Implemented and tested (run `npm test`): all UI screens; real auth (mandatory
TOTP); the encrypted vault; **Meta and LinkedIn** OAuth connect + publishing
(with labeled mock mode when an app isn't configured); the scheduling/publish
queue with retries, kill switch, and account removal; the media pipeline
(private signed-URL storage, uploads, image variants, ffmpeg video transcode,
IG container + Reels); the Meta insights collector (real-response-only metric
snapshots); Settings (autopilot mode, categories, encrypted keys, RSS trend
sources, notification prefs); the notification system; the RSS trending feed;
and production hardening (boot config guard, SQLite WAL + Litestream, `/api/health`).

Remaining platform integrations (X, YouTube, TikTok, Threads, Bluesky,
Pinterest, Google Business), auto-captions, and the AI studio are on the
roadmap — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#whats-next). The
system's controlled vocabularies and data map are in
[docs/DATA-MAP.md](docs/DATA-MAP.md).
