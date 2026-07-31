# QANTM Media — Publishing Portal

A secure, single-operator web portal to compose, schedule, and auto-publish
social content across ten platforms — Instagram, Facebook, X, LinkedIn,
YouTube, TikTok, Threads, Bluesky, Pinterest, and Google Business — from one
calendar.

Built security-first: optional TOTP two-factor auth, an AES-256-GCM encrypted
credential vault, a durable publish queue with retries, and a full audit log.

## Features

- **Compose once, publish everywhere** — one base caption, per-platform
  overrides, live validation against the tightest selected platform's limit,
  and a live post preview. Clip-proof custom date/time pickers.
- **AI writing (bring-your-own Anthropic key)** — all AI runs on your key,
  draft-only (human-reviewed), on the cheapest model (`claude-haiku-4-5`):
  - **Write with AI** rewrites your rough draft in your brand voice.
  - **AI draft** turns a trending news item into a source-grounded caption.
  - **Repurpose** adapts one piece of content into per-channel captions.
  - **Autopilot** plans a batch of original, on-brand drafts for review.
  - A **brand-voice** guide + fingerprint conditions all of the above.
  All AI ingests untrusted text as data (prompt-injection guarded) and never
  auto-publishes.
- **Reliable auto-publishing** — a durable job queue publishes at the scheduled
  time with exponential-backoff retries + jitter; failures surface the
  platform's actual error. A kill switch pauses everything instantly.
- **Real platform integrations** — Bluesky publishes for real today (app
  password; no developer app). Meta (Instagram + Facebook), LinkedIn, and
  YouTube connect via real OAuth **once their app credentials are configured**;
  until then they honestly show "Needs setup" — no fake connections. (A mock
  path exists only under the explicit `OAUTH_MOCK=1` dev flag.)
- **Visual calendar** — Month / Week / List (FullCalendar, MIT),
  drag-to-reschedule, color lenses by category, platform, or status.
- **Trending & breaking** — the composer surfaces items from your own RSS/Atom
  feeds. Per item: **Draft a post** (clean headline + a resolved article link),
  **AI draft**, and **Image** (suggests the story's `og:image`, attach only on
  your click — rights are yours). Hashtag suggestions are derived from your
  actual feed titles.
- **Dashboard** — weekly goal tracking and honest metrics: real numbers where a
  platform is connected, an explicit "connect analytics" state otherwise (never
  fabricated). Review inbox for Autopilot/Repurpose drafts.
- **Settings** — Autopilot mode, editable categories, the encrypted Anthropic
  key vault, RSS trend sources, and per-event notification preferences.
- **Notifications** — an in-app bell driven by real events, with optional email.

## Quick start

```bash
npm install
npx prisma migrate dev   # creates the local SQLite database
npm run dev              # http://localhost:3000
```

First run opens **/setup**: create the operator account. Two-factor is
**optional** — enable it to enroll a TOTP authenticator, or leave it off for
email + password sign-in.

Copy `.env.example` to `.env` and fill the secrets (32-byte base64 for
`SESSION_SECRET`, `VAULT_MASTER_KEY`, `STORAGE_SIGNING_KEY`, e.g.
`openssl rand -base64 32`). AI features need an Anthropic key added in-app
(Settings → Integrations & keys). Real OAuth publishing needs each platform's
app credentials (`META_*`, `LINKEDIN_*`, `YOUTUBE_*`) — see
[docs/REAL-PUBLISHING-SETUP.md](docs/REAL-PUBLISHING-SETUP.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (also boots the publish worker) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Full suite (unit + integration; isolated server + test DB) |
| `npm run test:unit` | Unit tests only |
| `npm run db:backup` | Online SQLite backup (`VACUUM INTO`) |

## Stack

Next.js 15 (App Router) · TypeScript · Prisma + SQLite (WAL; Litestream backups
in prod) · zustand · FullCalendar · jose · otplib · bcryptjs · Anthropic
(BYO-key, `claude-haiku-4-5`).

## Deployment

A `Dockerfile` + GitHub Actions publish a container image to GHCR (on `v*`
tags / manual dispatch), and `render.yaml` deploys it to Render with a
persistent disk. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design: data model,
  publish queue, credential vault, auth, AI seam.
- [docs/DATA-MAP.md](docs/DATA-MAP.md) — taxonomy, data sources, API surface,
  the audit-action registry, and system rules.
- [docs/REAL-PUBLISHING-SETUP.md](docs/REAL-PUBLISHING-SETUP.md) — per-platform
  credentials to publish for real.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
  · [docs/PLATFORM-RULES.md](docs/PLATFORM-RULES.md) ·
  [docs/SECURITY.md](docs/SECURITY.md) · [docs/VIDEO.md](docs/VIDEO.md)

## Status

Live and tested (`npm test`, 137 passing): all UI screens; optional-TOTP auth +
encrypted vault; **Bluesky real publishing** (verified end-to-end); the
scheduling/publish queue with retries, kill switch, and account removal; the AI
suite (Write-with-AI, AI draft, Repurpose, Autopilot, brand voice, memory
distill — all BYO-key, draft-only, injection-guarded); trending feeds with
link resolution + `og:image` suggestion + feed-derived hashtags; the media
pipeline (signed-URL storage, image variants, ffmpeg transcode, IG container +
Reels); Settings; notifications; and production hardening (boot config guard,
SQLite WAL + Litestream, `/api/health`, container image + Render blueprint).

Meta / LinkedIn / YouTube OAuth is built and connects for real once app
credentials are configured (they show "Needs setup" until then). X, TikTok,
Threads, Pinterest, and Google Business publishing are future integration waves.
