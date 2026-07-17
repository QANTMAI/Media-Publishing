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
- **Autopilot** — plans a week of scheduled posts across connected accounts
  in one click; turning it off cleanly removes unpublished planned posts.
- **Dashboard & analytics** — weekly goal tracking, quick numbers, and
  plain-English recommendations.

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

Next.js 15 (App Router) · TypeScript · Prisma (SQLite dev / Postgres prod) ·
zustand · FullCalendar · jose · otplib · bcryptjs

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design: data model,
  publish queue, credential vault, auth flow.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — environment, database,
  testing, and platform-integration notes.

## Status

The UI (all screens), real auth, the encrypted vault, the Meta OAuth connect
flow, the scheduling/publish pipeline, and the media pipeline (private
storage with signed URLs, uploads, image variants, asset library, composer
attachments, Instagram container flow) are implemented and tested (28-test
suite). Remaining platform integrations, video tooling, analytics pulls, and
the AI studio are on the roadmap — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#whats-next).
