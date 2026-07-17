# Architecture

A conventional three-tier web app with one defining property: **publishing is
asynchronous**. Nothing posts in the request/response cycle — a durable job
queue does the work, which is what makes retries, rate-limit handling, and
"publish at 6 pm" reliable.

```
Client (Next.js app)          API (route handlers)         Publisher worker
composer · calendar    ──►    auth, posts CRUD,      ──►   claims due jobs,
library · accounts            account linking,             calls platform APIs,
                              schedule management          retries, writes back
        │                            │                            │
        └────────────┬───────────────┴───────────────┬────────────┘
                     ▼                               ▼
              Database (Prisma)                Secrets vault
              posts, targets, jobs,            AES-256-GCM encrypted
              accounts, audit log              OAuth tokens
```

## Data model

| Entity | Purpose |
|---|---|
| `User` | The single operator: bcrypt password hash, TOTP secret, replay-guard step |
| `SocialAccount` | One connected profile; many rows may share a platform. `tokenRef` → vault |
| `Post` | Base caption, category, source (`manual` \| `autopilot`) |
| `PostTarget` | One post × one account: schedule, state machine, permalink, error |
| `PublishJob` | Queue row: `runAt`, attempts, claim marker, completion |
| `VaultSecret` | Encrypted credential blob (never exposed to the client, never logged) |
| `AuditEvent` | Login/connect/publish trail |
| `Setting` | Operator flags shared with the worker (kill switch, autopilot) |

Target state machine: `draft → scheduled → publishing → published | failed`,
with `cancel` returning to `draft` (nothing is deleted).

## The publish queue

The queue **is** the `PublishJob` table — durable and transactional. Redis or
BullMQ can be swapped in later; the semantics below are the contract.

- **Atomic claim** — a conditional `updateMany` on the claim marker; safe with
  any number of worker processes.
- **Retries** — exponential backoff (1 m → 2 m → 4 m …), max 5 attempts.
- **Permanent failures** (no credentials, unintegrated platform) fail
  immediately with the reason stored on the target and shown in the UI.
- **Idempotency** — the external publish is recorded on the target before the
  job closes; a crash-recovery reclaim re-runs the publisher, which returns
  the recorded permalink instead of posting twice. Bookkeeping failures after
  a successful publish are never classified as publish failures.
- **Holds** — the kill switch stops all claiming; a paused account defers its
  own jobs without burning retry attempts.
- **Races** — cancel and reschedule run in transactions that refuse while a
  claimed (in-flight) job exists, so a mid-publish post can't be silently
  cancelled or double-published.

The worker is a re-entrancy-guarded 15-second poller booted from Next.js
`instrumentation.ts`; in a multi-instance deployment it runs as its own
process (the claim semantics already make that safe).

## Credential vault

OAuth tokens are encrypted at rest with AES-256-GCM (random IV per secret,
auth tag verified on read). Locally the master key comes from
`VAULT_MASTER_KEY`; in production this module is the seam where KMS envelope
encryption plugs in. Invariants: plaintext tokens never reach the client,
never appear in logs, and are only decrypted inside server-side publish and
connect paths. Disconnect deletes the vault row **and** revokes platform-side
(for Meta, only when disconnecting the last connected Meta account — their
revoke endpoint kills the whole user grant).

## Authentication

- First-run `/setup` creates the operator and enrolls **mandatory TOTP 2FA**
  (QR + manual key, confirmed with a live code before the account activates).
- Sign-in: password (bcrypt) → 5-minute preauth cookie → TOTP → 12-hour
  session (jose-signed JWT, httpOnly, SameSite=Lax, Secure in production).
- Hardening: rate limits on login (5 / 15 min) and verify (5 per preauth,
  then the preauth is revoked); accepted TOTP time-steps are persisted so a
  code can never be replayed, even inside its validity window.

## Media storage

Files live in **private object storage** and are reachable only through
signed, expiring URLs — there is no public directory and no unsigned access.
The local adapter is filesystem-backed; its contract (server-generated keys,
presigned PUT/GET, delete) mirrors S3 semantics so production swaps the
implementation, not the call sites. Signatures are HMAC-SHA256 over
method·key·expiry, verified in constant time; storage keys are generated
server-side, so path traversal is impossible by construction.

Upload flow: `presign` (validates the declared type/size, rate-limited,
mints a 10-minute PUT URL with the kind's byte cap signed in) → the client
streams bytes directly to storage → `complete` re-validates server-side,
probes dimensions, and generates platform-fit image variants via sharp
(1:1, 4:5, 16:9, thumbnail). Videos transcode asynchronously in the media
worker (ffmpeg renditions + cover frame — see docs/VIDEO.md). The database
stores only `Asset` metadata and keys — never bytes. Deleting an asset is
refused while any draft or scheduled post references it.

## Platform integrations

Meta (Instagram + Facebook + Threads) share one developer app: OAuth code →
long-lived user token → page tokens + linked Instagram business accounts,
all stored in the vault. With no Meta app configured (`OAUTH_MOCK=1`), the
connect flow simulates the grant end-to-end with clearly labeled mock tokens
so everything is testable before platform app review completes.

Publishing today: Facebook Page posts and the Instagram container flow
(create media container from a hosted image URL → publish → read back the
permalink) via the Graph API for real tokens; mock tokens publish to labeled
mock permalinks. Real Instagram publishing additionally needs
`PUBLIC_ORIGIN` set so Meta can fetch the signed media URL.

## What's next

1. Remaining platform integrations in waves: X, LinkedIn, YouTube →
   TikTok, Pinterest, Google Business → Bluesky.
2. Rest of video tooling: auto-captions (speech-to-text) and in-browser trim
   (transcodes + Reels publishing are done — docs/VIDEO.md).
3. Analytics pulls: Meta insights collection is BUILT (researched v25.0
   metric names — `views`/`post_media_view` era, not the deprecated
   `impressions` family; 6-hourly collector in the worker; time-series
   `MetricSnapshot` rows written only from real API responses, mock
   publishes get none). It activates with real tokens; X/LinkedIn/YouTube
   metrics land with their integrations.
4. AI content studio (bring-your-own-key) and the optimizer/growth engine.
5. Production hardening: Postgres, KMS, S3 storage adapter, automated
   backups, observability, pen test.
