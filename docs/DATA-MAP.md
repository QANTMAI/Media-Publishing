# Data map, taxonomy & legend

The system's controlled vocabularies, where each one is **owned**, the data
sources it touches, and the rules that keep them consistent. This is the legend
the whole platform reads from.

> **Single-source rule.** Every fixed set of string values (platforms, states,
> provenance, audit actions, notification types) is declared **once** in
> [`src/lib/taxonomy.ts`](../src/lib/taxonomy.ts), derived from the config that
> already owns it. `tests/taxonomy.test.mts` fails the build if code emits a
> value outside the registry — so drift is caught, not shipped. Adding a
> platform, state, or audit action means updating the registry; nothing else
> is allowed to invent vocabulary inline.

## 1. Taxonomy legend

| Vocabulary | Values | Owned by | Notes |
|---|---|---|---|
| **Platform id** | instagram, facebook, x, linkedin, youtube, tiktok, threads, bluesky, pinterest, gbp | `taxonomy.PLATFORMS` (derives from `types.PlatformId` + `platforms.PLATFORM_COLORS`) | 10 modeled |
| **Platform mark** | IG, FB, X, IN, YT, TT, TH, BS, PN, GB | same | 1:1 with id |
| **Publishable platform** | instagram, facebook, x, linkedin, youtube, tiktok | `taxonomy.PUBLISHABLE_PLATFORM_IDS` (= keys of `PLATFORM_RULES`) | The honest "what can actually publish" subset. A platform with no rules entry **cannot be scheduled** (422). |
| **Account status** | connected, expiring, paused, disconnected | `taxonomy.ACCOUNT_STATUSES` / `types.AccountStatus` | |
| **Account provenance** | real, mock, demo | `taxonomy.ACCOUNT_PROVENANCE` / `SocialAccount.provenance` | **First-class** (not inferred from `label`). Only `real` reaches a live platform; everything else is flagged in the UI. |
| **Post status** (aggregate) | draft, scheduled, published, failed | `taxonomy.POST_STATUSES` / `Post.status` | |
| **Target state** (machine) | draft, scheduled, publishing, published, failed, cancelled | `taxonomy.TARGET_STATES` / `PostTarget.state` | Superset of post status; `GET /api/posts` serves this. Colors: `TARGET_STATE_COLORS` (all six). |
| **Calendar lens** | category, platform, status | `taxonomy.LENSES` / `types.Lens` | |
| **Calendar view** | month, week, list | `taxonomy.CAL_VIEWS` | |
| **Post type** | image, video | `taxonomy.POST_TYPES` | |
| **Category** | operator-defined data (seeded: Promo, Educational, Behind the scenes, Tutorial, Trend, News) | `Category` table; seeds in `platforms.DEFAULT_CATEGORIES` | Posts reference a category by **name string**, never FK — a delete never cascades history. |
| **Notification type** | publish_failed, review_ready | `taxonomy.NOTIFY_TYPE_KEYS` + `server/notifications.NOTIFY_TYPES` | |
| **Notification level** | info, warn, error | `taxonomy.NOTIFY_LEVELS` | |
| **Asset type / status** | image·video / ready·processing·failed | `Asset` model | |
| **Audit action** | 43 actions across 11 domains | `taxonomy.AUDIT_ACTIONS` | See §5. The registry test asserts every `audit("…")` call site uses a registered action. |

### Provenance — the honesty field

`label` is a *user-facing disambiguation* string ("my second IG"). It used to
double as the provenance signal (`label === "demo"`), which silently missed
mock connections. Provenance is now its own column:

- `real` — a genuine OAuth grant; publishes for real.
- `mock` — `OAUTH_MOCK` simulated connects and test fixtures; publishes to a
  labeled `mock.qantm.local/…` permalink, never a live platform.
- `demo` — seeded sample rows for an empty UI.

`taxonomy.isRealProvenance()` is the single gate; `taxonomy.provenanceTag()`
gives the UI badge. The migration `20260723151905_account_provenance` backfills
old rows from the legacy label markers (`taxonomy.LEGACY_LABEL_PROVENANCE`).

## 2. Data sources & storage (what this repo actually touches)

| Source | What lives there | Access |
|---|---|---|
| **SQLite database** (`DATABASE_URL`, WAL mode) | All operator data: accounts, posts, targets, jobs, assets metadata, metric snapshots, audit log, notifications, feed sources+items, categories, credentials, vault ciphertext, settings | Prisma (`src/lib/server/db.ts`); durability via WAL + Litestream ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| **Local object storage** (`STORAGE_DIR`, default `storage/`) | Media **bytes** only (originals + image variants + video renditions + cover frames). Never in the DB. | Signed expiring URLs, server-generated keys (`src/lib/server/storage.ts`, `media.ts`) |
| **Encrypted vault** (rows in SQLite `VaultSecret`) | OAuth tokens; AES-256-GCM, master key = `VAULT_MASTER_KEY`. Plaintext never leaves the server, never logged. | `src/lib/server/vault.ts` |
| **Meta Graph API** | Real IG/FB publishing + insights (real tokens) | `src/lib/server/meta.ts`, `publisher.ts`, `insights.ts` |
| **LinkedIn API** | Member OAuth + versioned Posts API publishing | `src/lib/server/linkedin.ts` |
| **Operator RSS/Atom feeds** | Trending items (public feed URLs the operator adds) | `src/lib/server/feeds.ts` |
| **SMTP** (optional, `SMTP_URL`/`SMTP_FROM`) | Email mirror of notifications | `src/lib/server/email.ts` |
| **Anthropic API** (operator key in vault) | AI features (seam present; consumer is roadmap) | `Credential` model |

### External sources declared by the operator — NOT yet mapped

The operator has stated that signal-related data also lives in **Google Cloud**,
**Google Drive**, and a **VM**. These are **outside this repository and have not
been observed** by any tooling available in this workspace. They are recorded
here as *pending discovery* — their contents, schemas, and merge strategy MUST
be established from the actual sources before anything is written about them.
Nothing about their structure is assumed. See §6.

## 3. Core data model (15 Prisma models)

`User` (single operator) → owns `SocialAccount`, `Post`, `Asset`, `Category`,
`Credential`, `Notification`, `FeedSource`, `AuditEvent`.

```
Post ──< PostTarget >── SocialAccount ──? VaultSecret
              │                └─ provenance: real|mock|demo
              ├──< PublishJob            (the durable queue)
              └──< MetricSnapshot        (real-response-only insights, time series)
FeedSource ──< FeedItem                  (RSS/trending)
Setting                                  (KV: kill switch, autopilot)
```

- `Post.category` is a **name string**, not an FK to `Category` (delete-safe).
- `PostTarget` carries the state machine, permalink, `externalMediaId`, error.
- `MetricSnapshot` is append-only per pull — a bad pull never destroys history;
  written **only** from real API responses (mock publishes get none).
- `VaultSecret` is referenced only by `SocialAccount.tokenRef`; the hourly
  worker sweep deletes any unreferenced ciphertext.

## 4. Signal-data ingestion paths

Where data *enters* the system, with the writer and cadence:

| Signal | Enters via | Writes | Cadence |
|---|---|---|---|
| Post metrics | `insights.collectMetricsCycle()` (real tokens only) | `MetricSnapshot` | worker, every 6h |
| Trending items | `feeds.pollFeeds()` | `FeedItem` (deduped per source) | worker, every ~3h + manual refresh |
| Notifications | `notifications.notify()` at real events (publish permanent-fail, autopilot review) | `Notification` (+ optional email) | event-driven |
| Audit trail | `audit()` at every state change | `AuditEvent` | event-driven |
| Publish results | worker `processJob()` | `PostTarget.state/permalink/error`, `PublishJob` | queue, 15s poll |

All are **real-only**: no fabricated metrics, no synthetic notifications. Mock
publishes are excluded from metric collection by the `mock-token-` guard.

## 5. Audit action legend

Every audited action, grouped (source of truth: `taxonomy.AUDIT_ACTIONS`):

- **auth** — setup, setup.confirmed, setup.throttled, login, login.failed, login.throttled, verify, verify.failed, verify.replayed, verify.throttled, logout, dev_login
- **account** — connect, connect_failed, disconnect, pause, resume, remove
- **publish** — success, retry, failed
- **post** — approve, cancel, discard, edit, reschedule
- **autopilot** — on, off, mode
- **asset** — upload, transcoded, transcode_failed, delete
- **category** — create, update, delete
- **credential** — set, test, delete
- **feed** — add, toggle, delete
- **notify** — prefs
- **metrics** — collected, rate_limited

## 6. API surface (39 routes)

Auth = requires a full session (`readSession`). "handshake" = part of the login
flow (password/TOTP, pre-session). "signed" = gated by an HMAC signature, not a
session. Verified against `src/app/api/**/route.ts`.

**Auth & session** — `POST /auth/setup`, `POST /auth/setup/confirm`,
`GET /auth/status` (handshake); `POST /auth/login`, `POST /auth/verify` (handshake);
`GET /auth/me`, `POST /auth/logout` (auth); `POST /auth/dev-login` (dev-only, 404 in prod).

**Accounts & OAuth** — `GET /accounts`; `PATCH,DELETE /accounts/:id` (DELETE `?purge=1` removes);
`GET /oauth/meta/start`, `GET /oauth/meta/callback`; `GET /oauth/linkedin/start`, `GET /oauth/linkedin/callback`.

**Posts & scheduling** — `GET,POST /posts`; `PATCH,DELETE /posts/:postId`;
`POST /posts/:postId/approve`; `PATCH /targets/:id`; `POST /targets/:id/cancel`;
`POST /autopilot`; `GET,PUT /settings`.

**Categories** — `GET,POST /categories`; `PATCH,DELETE /categories/:id`.

**Media** — `GET /assets`; `POST /assets/presign`; `POST /assets/complete`;
`DELETE /assets/:id`; `GET,PUT /storage/:key` *(signed URLs — no session; HMAC over method·key·expiry)*.

**Credentials (vault)** — `GET /credentials`; `PUT,DELETE /credentials/:provider`;
`POST /credentials/:provider/test`.

**Notifications** — `GET /notifications`; `POST /notifications/read`; `GET,PUT /notifications/prefs`.

**Feeds (trending)** — `GET,POST /feeds`; `PATCH,DELETE /feeds/:id`; `POST /feeds/refresh`.

**Insights & ops** — `GET /metrics` (auth); `GET /health` *(public liveness/readiness — secret-free)*.

## 7. Rules the system follows

1. **One vocabulary owner.** Declare controlled values in `taxonomy.ts`; never
   inline a new status/platform/action string. The registry test enforces it.
2. **Config, not code, for limits.** Platform caption/media/video limits live
   in versioned config and are both displayed and enforced from it — see
   [PLATFORM-RULES.md](PLATFORM-RULES.md). No hand-written numbers in UI/copy.
3. **Honesty is a field, not a guess.** Provenance is stored, not inferred.
   Anything not `real` is visibly flagged and never publishes live. No fakes.
4. **Signals are real or absent.** Metrics/notifications are written only from
   real events; empty states say "not connected yet", never fabricated numbers.
5. **Secrets never leave the server.** Vault plaintext is never returned,
   logged, or sent to the client; credentials return only a masked hint.
6. **History is durable.** Deletes don't cascade posting history (category by
   name, metrics append-only, cancel is a state not a delete).
7. **External data is mapped from the source, never assumed.** For Google
   Cloud / Drive / VM data (§2), no schema or merge plan is written until the
   actual source is observed.
