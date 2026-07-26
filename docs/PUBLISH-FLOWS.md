# Publish Flows — End-to-End Reference

Traced from source, not memory. Every claim cites `file:line`. Where a mechanism
the reader might expect is **absent**, this doc says so explicitly (see §16) —
that is the point of the document. The five channels with real publish code are
**Instagram, Facebook, LinkedIn, Bluesky, YouTube**; X/TikTok/Threads/Pinterest/
Google Business are modeled but not yet wired (`publisher.ts:143`).

The queue **is the database** — Prisma over SQLite. There is no Redis/BullMQ; the
claim/backoff semantics in `worker.ts` are the whole contract (`worker.ts:1-4`).

---

## 1. The spine — three rows per scheduled post

```
Post ─┬─ PostTarget (one per selected account) ─── PublishJob (one per target, non-drafts only)
      │        state: draft→scheduled→publishing→published|failed          runAt / claimedAt / completedAt / attempts
      └─ status: draft|scheduled  (never rolled up after scheduling — §12)
```

| Row | Model | Drives what |
|---|---|---|
| `Post` | `schema.prisma:243`; `status` `:248` (`draft\|scheduled\|published\|failed`) | Caption, category. `status` is set at create/approve only. |
| `PostTarget` | `schema.prisma:257`; `state` field `schema.prisma:264` | Per-account publish state. The worker mutates **this**, never `Post`. |
| `PublishJob` | `schema.prisma:297`; `runAt` `:300`, `attempts` `:301`, `claimedAt` `:303`, `completedAt` `:304` | The only queue the worker reads. No `state` string — lifecycle is the three nullable timestamps + `attempts`. |

`PublishJob.runAt` is the **only** due-ness field the worker uses; `PostTarget.scheduledAt` is display/calendar time and the worker never reads it (`worker.ts:39-47`).

---

## 2. Scheduling — Post → PostTarget → PublishJob

`POST /api/posts` (`posts/route.ts`):

1. Rejects a non-draft `scheduledAt` more than 60 s in the past (`posts/route.ts:86-88`).
2. Rejects any account whose platform has **no `PLATFORM_RULES` entry** — no guaranteed-to-fail job is ever minted (`posts/route.ts:108-115`). This is the gate that opens for a platform the moment it gets a rules entry (that's how Bluesky/YouTube became schedulable).
3. Creates one `Post` + **one `PostTarget` per account** (`posts/route.ts:159-175`).
4. Creates **one `PublishJob` per target**, `runAt = scheduledAt` — **only for non-drafts** (`posts/route.ts:176-181`). Comment: "Drafts get NO publish job — nothing is queued until they're scheduled."

The worker boots **in-process** via Next.js instrumentation (`instrumentation.ts`), once per process (`worker.ts:167-174`), polling every 15 s (`worker.ts:24,222`). Multi-instance deployments should run it as one separate process; the atomic claim (§5) makes that safe (`instrumentation.ts` note).

---

## 3. Human approval — review vs auto

Delivery mode is a setting; **default `review`** (`settings.ts:24-25`).

**Review mode** (autopilot planning, `autopilot/route.ts:41-70`; manual drafts, `posts/route.ts:176`): the Post + PostTarget are created `draft` with a stored `scheduledAt` **but no `PublishJob`** — the worker literally cannot see it. A `review_ready` notification fires (`autopilot/route.ts:76-84`).

**Approve** (`approve/route.ts`) promotes it:
- Ownership-scoped load (`{ id: postId, userId }`, `approve/route.ts:19-20`).
- **Draft-only:** filters to `state === "draft"`; 409 if none (`approve/route.ts:25-28`). Non-draft targets in the same post are untouched.
- Re-runs the same gates as scheduling: connected account, platform integrated, caption within limit (`approve/route.ts:31-49`).
- Keeps the planned time if still future, else bumps to `now + 15 min` (`approve/route.ts:51-56`).
- **One `$transaction`**: each target → `scheduled`, a `PublishJob` per target, and `Post.status → scheduled` — "no window where a target is scheduled with no job" (`approve/route.ts:61-67`). Audits `post.approve` (`approve/route.ts:69`).

**Auto mode** skips all of that — planned posts are created `scheduled` with a `PublishJob` immediately (`autopilot/route.ts:68-70`); no approval, no `review_ready`. There is **no review inbox for auto mode**.

**Discard** (`DELETE /api/posts/:id`) refuses anything that isn't a pure draft — 409 "Only drafts can be discarded — cancel scheduled posts instead" (`[postId]/route.ts:57-60`). **Autopilot OFF** deletes only un-published autopilot posts and deliberately **spares in-flight ones** — targets that are `published`/`publishing` or have a claimed (`completedAt: null, claimedAt: not null`) job are left for the worker to finish (`autopilot/route.ts:92-105`).

> Note: autopilot captions are canned and prefixed `"Draft ·"`, **not** AI-generated — the code refuses to imply a model is involved until the AI studio ships (`autopilot/route.ts:14-22`).

---

## 4. Claim & concurrency

One cycle = `runQueueCycle()` (`worker.ts:35-61`):

1. Kill switch checked **first** — if on, returns processing nothing (`worker.ts:36`).
2. Find due jobs: `completedAt: null`, `runAt <= now`, and `claimedAt` null **or** older than the 10-min stale window (`worker.ts:38-47`).
3. **Atomic claim** — a compare-and-set on `claimedAt` (`worker.ts:52-56`):
   ```ts
   const claim = await db.publishJob.updateMany({
     where: { id: job.id, completedAt: null, claimedAt: job.claimedAt },
     data: { claimedAt: now },
   });
   if (claim.count === 0) continue;
   ```
   A single SQLite `UPDATE` is atomic, so two racing workers → exactly one gets `count === 1`; the loser skips. This is a **claim marker, not a timed lease** — `claimedAt` is only cleared on retry/hold (`worker.ts:112,153`) or superseded after it goes stale.

Constants: `POLL_MS 15s`, `BATCH 10`, `STALE_CLAIM_MS 10 min`, `MAX_ATTEMPTS 5`, `BACKOFF_BASE_MS 60s` (`worker.ts:24-28`). A same-process re-entrancy guard (`__qantmWorkerBusy`) stops a slow cycle overlapping the next tick (`worker.ts:196-197`). Crash recovery: a claim older than 10 min becomes due again (`worker.ts:43`).

---

## 5. Retries & backoff

- Counter `PublishJob.attempts` (default 0, `schema.prisma:301`), incremented as `nextAttempts = attempts + 1` (`worker.ts:119`).
- Max 5 (`worker.ts:25`).
- Backoff (`worker.ts:30-32`): `BACKOFF_BASE_MS * 2 ** (attempts-1)` → **1m, 2m, 4m, 8m**. **No cap** — the function has no `Math.min` (§16).
- Retry vs permanent (`worker.ts:120`): `const permanent = err instanceof PermanentError || nextAttempts >= MAX_ATTEMPTS`.
- Retryable path resets `claimedAt: null`, pushes `runAt` out by backoff, reverts the target to `scheduled`, audits `publish.retry` (`worker.ts:145-159`).

**Only Phase-1 errors are classified.** Only exceptions from `publishTarget()` reach `recordFailure` (`worker.ts:70-74`); bookkeeping (Phase-2) errors are handled separately (§6) so a DB hiccup after a live publish is never treated as a publish failure.

---

## 6. Idempotency — and the one honest gap

Two layers; the load-bearing one is in the publisher.

**Layer 1 — published short-circuit** (`publisher.ts:48-51`): a re-run of `publishTarget` returns the recorded result **without calling any platform API** when the target is already `published` with a `permalink`:
```ts
if (target.state === "published" && target.permalink) {
  return { permalink: target.permalink, externalMediaId: target.externalMediaId ?? null };
}
```

**Layer 2 — ordered writes** (`worker.ts:77-100`): after a live publish, the worker writes the target to `published` **first** (the idempotency marker), then closes the job, retrying transient DB errors up to 3× (`worker.ts:81-100`). If all 3 fail, the job is **left claimed on purpose** — the 10-min stale reclaim re-runs it, and Layer 1 makes that a no-op *if the target write landed* (`worker.ts:91-97`).

> **Honest residual window:** if the platform published but the *very first* `postTarget → published` write never lands, Layer 1's guard isn't satisfied, so a reclaim 10 min later can call the platform API **again**. There is **no external/platform idempotency key** — dedup relies entirely on the local `published` marker. Per-platform, the internal risk differs (§15): Bluesky/LinkedIn/Facebook commit in a single request (tight); Instagram (create→poll→publish) and YouTube (initiate→PUT) commit across two calls, so a crash after the platform commit but before the local write is the exposure.

---

## 7. Deduplication

**`PostTarget` now carries `@@unique([postId, socialAccountId])`** (migration `posttarget_account_unique`) — the DB rejects a second target for the same (post, account). The posts route also dedupes `accountIds` before creating targets. `PublishJob` still has no unique constraint (only `@@index([runAt, completedAt])`, `schema.prisma:309`) — but exactly one job is created per target, so duplicate jobs don't arise in practice. The **only** guard against duplicate work is procedural: exactly one job per target at schedule time, none for drafts (`posts/route.ts:176-181`). Uniqueness that *does* exist is elsewhere: `SocialAccount @@unique([platform, externalId])` (`schema.prisma:216`), `FeedItem`, `Credential` — none of them target/job dedup.

---

## 8. Rate-limit handling — reactive only

**There is no app-side throttle on publishing.** `rate-limit.ts` is a fixed-window in-memory limiter used **only for the auth endpoints** (`rate-limit.ts:1-3`). Platform rate limits are handled **reactively**: each platform's rate-limit response is classified as a **retryable** `Error`, and the worker's exponential backoff (§5) spaces the retry out. Per channel:

| Channel | Treated as retryable (backoff) | Source |
|---|---|---|
| Instagram / Facebook | Meta app-limit codes `4, 17, 32, 613`; IG `9007` "media not ready" | `publisher.ts` graph handlers (IG `:264-266`, FB `:368`) |
| LinkedIn | `409`, `429` (150/day), `5xx` | `linkedin.ts` `classifyLinkedInError` |
| Bluesky | `429`, `5xx`, `/rate ?limit/` (incl. login rate limits) | `bluesky.ts` |
| YouTube | `429`, `5xx`, `rateLimitExceeded`, `userRateLimitExceeded` | `youtube.ts` `classifyYouTubeError` |

**YouTube `quotaExceeded` is the deliberate exception — it is PERMANENT, not retried** (`youtube.ts`), because the default 10 000-unit/day quota (≈6 uploads) won't recover within the minutes-scale backoff, and retry-looping would only burn more quota.

---

## 9. Dead-letter behavior — there is none

**No dead-letter queue exists** — no DLQ table, no `deadLetter` field, no re-queue-elsewhere path. Terminal failure is just:

- `PublishJob.completedAt` set (removing it from the due query) + `attempts` + `lastError` (`worker.ts:122-129`), **and**
- `PostTarget.state = "failed"` with the error stored (`worker.ts:128`),
- audited `publish.failed` (`worker.ts:130`) and surfaced by a `publish_failed` notification (§14).

`completedAt` is shared by success and permanent failure — success sets `lastError: null` (`worker.ts:87`), failure sets `lastError: message` (`worker.ts:126`); distinguish by `lastError`/target state, not by `completedAt` alone. A failed job is never auto-resurrected; recovery is the operator rescheduling. Publish-job rows are **not** pruned (only orphan uploads/vault secrets are, `worker.ts:202-205`).

---

## 10. Token refresh — per channel

The durable credential stored in the vault differs per channel, and so does whether anything is refreshed:

| Channel | Stored in vault | Refresh at publish? | When the credential dies |
|---|---|---|---|
| **Instagram / Facebook** | Page access token (from a ~60-day long-lived user token) — `meta.ts:50-65,75-99` | **No** | User token expiry (~60d) or user revokes → next publish 4xx → **permanent** → reconnect. Disconnect calls a real revoke (`meta.ts:103-107`). |
| **LinkedIn** | 60-day access token (`linkedin.ts:53-84`) | **No** (programmatic refresh is partner-only) | At 60 days → publish `401` → **permanent** → reconnect. No revoke endpoint exists; disconnect just deletes the vault copy (`linkedin.ts:16-20`). |
| **Bluesky** | **App password** (durable) | **Full re-auth every publish** — `createSession` mints a fresh `accessJwt` per post (`bluesky.ts` `publishBluesky`) | Only when the user revokes the app password → `createSession` fails → **permanent** → reconnect. |
| **YouTube** | **Refresh token** (durable) | **Yes** — `youtubeRefreshAccess` mints an access token every publish (`youtube.ts`; `publisher.ts:89-94`) | `invalid_grant` (revoked) → **permanent** → reconnect. |

> **`expiresAt` is stored but never acted on.** No scheduler proactively refreshes or flips an account to `expiring`. Grep shows the `"expiring"` status is only ever set on **demo seed data** (`seed-accounts.ts`), never by runtime logic — the UI renders a Reconnect button for it, but a real account stays `connected` until a publish fails. A dead token surfaces as a **failed post + notification**, not an account badge, and the publish path does **not** auto-flip the account to `disconnected`/`expiring`.

---

## 11. Partial failure — per-target, no post rollup

Targets are **independent jobs** — one `PublishJob` per target, claimed and processed individually (`worker.ts:50-59`). In a multi-account post, outcomes diverge freely: some `published`, some `failed`, some `scheduled` (retrying), some held (paused account) — each transitions on its own (`worker.ts:63-161`).

**There is no post-level "partially published" concept.** The worker/publisher mutate **only `PostTarget.state` — never `Post`** (grep-confirmed: no `db.post.update` in either file). `Post.status` is written at create/approve only; its declared `published`/`failed` values are never written by the publish path. Aggregate state lives per-target and is surfaced as `t.state` through `GET /api/posts` (`posts/route.ts:39`).

---

## 12. Audit logs

`audit(action, { userId?, ip?, metadata? })` writes an `AuditEvent` row (`action`, `userId`, `ip`, `metadata` as a JSON string) — `audit.ts:6-18`. **It swallows its own errors and never rethrows** (`audit.ts:19-22`) — a failed audit cannot break a publish. Worker-emitted publish audits pass `{ metadata }` only, so their `userId`/`ip` are `null` (`worker.ts:88,130,158`).

**IP is `null` unless `TRUST_PROXY=1`** (`audit.ts:30`); when trusted, it takes the **last** `X-Forwarded-For` entry (the app's own proxy hop; earlier entries are client-spoofable) — `audit.ts:31-32`. The worker calls `audit()` without an IP; API routes pass `requestIp(req)`.

Publish/account/auth actions are declared in the single-source registry `AUDIT_ACTIONS` (`taxonomy.ts:174-200`), enforced by an anti-drift test. Publish path actually emits: `publish.success` (`worker.ts:88`), `publish.retry` (`worker.ts:158`), `publish.failed` (`worker.ts:130`); connect path emits `account.connect` / `account.connect_failed`; the kill switch emits `publish.pause_all` / `publish.resume_all`.

---

## 13. Notifications

A `publish_failed` notification is created **only in the permanent-failure branch**, after the target is marked failed — it looks up the owner + account for a specific message (`worker.ts:131-144`). **No notification on retryable failures or paused-account holds.** `review_ready` is the only other type, created by autopilot review planning (`autopilot/route.ts:76-84`), not the publish path. Both types: `notifications.ts:19-31`.

`notify()` **never throws into its caller** (`notifications.ts:7,98`), and the worker's notification lookup is itself `.catch(() => null)` guarded (`worker.ts:133-135`) — a notification failure can't take down a publish. Email is mirrored only when the `email` pref is on **and** SMTP is configured (`notifications.ts:91-97`).

---

## 14. Per-channel publish trace (the actual call sequence)

All five run **only after** the shared preamble in `publishTarget` (`publisher.ts`): idempotency short-circuit (`:50`), paused-account guard (`:53-57` → retryable "Account is paused" hold, §4), token read from vault (`:59-60`), and the **mock short-circuit** — a `mock-token-…` returns a labeled mock permalink and never touches a real API (`:67-70`).

| Channel | Media | Call sequence | Commit point | Permanent conditions |
|---|---|---|---|---|
| **Facebook** (`publisher.ts:76`) | text | one `POST /{page}/feed` | the POST (has `id`) | non-rate-limit 4xx → `Facebook rejected the post` (`:370`) |
| **LinkedIn** (`publisher.ts:78`) | text | one `POST /rest/posts` (versioned) | `201` (`x-restli-id` = URN) | `401/403` reconnect; other 4xx reject (`linkedin.ts`) |
| **Bluesky** (`publisher.ts:82`) | text + ≤4 images | `createSession` → `uploadBlob` × N (safe to retry) → **one `createRecord`** | `createRecord` returns `uri` | bad creds; other 4xx; video → honest PermanentError |
| **YouTube** (`publisher.ts:89`) | video **required** | `youtubeRefreshAccess` → resumable **initiate** (metadata) → **PUT** bytes | `PUT` returns `200/201` (video `id`) | `quotaExceeded`, `invalid_grant`, `401`, `400` |
| **Instagram** (`publisher.ts:96`) | image or Reel **required** | create container → (Reels: poll `status_code` ≤4 min) → `media_publish` | `media_publish` returns `id` | missing/failed media; non-rate-limit 4xx → `Instagram rejected the post` (`:269`) |

Every platform function follows the rule "**once the platform commit returns, nothing may throw**" — the permalink read-back is best-effort and falls back rather than throwing, so a cosmetic failure never triggers a double-post retry (e.g. IG `publisher.ts` Reel/image read-back; LinkedIn `linkedin.ts` 201-without-header path).

Media requirements are enforced with real reasons, not opaque API errors: IG needs image/video (`publisher.ts:96`+), YouTube is video-only and validates against `VIDEO_SPECS` before upload (`publisher.ts` `loadYouTubeVideo`), Bluesky rejects video as a not-yet-integrated embed.

---

## 15. Kill switch & per-account pause

- **Kill switch** ("Pause all publishing") — `Setting` key `killSwitch` (`settings.ts:15-16`); the worker checks it first each cycle and holds the **entire** queue with `runAt` untouched, so everything overdue fires on resume (`worker.ts:36`). Soft global gate, audited `publish.pause_all` / `publish.resume_all`.
- **Per-account pause** — caught inside `publishTarget` as `"Account is paused"` (`publisher.ts:53-57`); the worker holds only that account's jobs: **no attempt burned**, `runAt +5 min`, `claimedAt` cleared, target reverted to `scheduled` (`worker.ts:107-117`).

---

## 16. What does NOT exist (verified absent)

Consolidated honest inventory — these are real, current gaps, not oversights in the trace:

- **No dead-letter queue.** Terminal failure = `PublishJob.completedAt` + `PostTarget.state="failed"` (§9).
- **No external/platform idempotency key** (per-platform, scheduled). Double-publish prevention relies on the local `published` marker. The **reclaim** double-publish path is now closed (`worker.ts` no longer clobbers a `published` target to `publishing`, so the publisher's guard fires — regression-tested). The residual window is only when the *first* `published` write fails entirely; a platform-level key would close it but is per-platform (Bluesky's `app.bsky.feed.post` uses TID record keys → needs a deterministic-TID design; Meta/LinkedIn/YouTube expose no client idempotency token).
- ✅ **`(post, account)` uniqueness — shipped.** `@@unique([postId, socialAccountId])` (migration `posttarget_account_unique`) + `accountIds` dedup in the posts route (§7).
- **No app-side publish rate limiting.** The in-memory limiter is auth-only; platform limits are absorbed reactively by backoff (§8).
- **No proactive token refresh / no `expiring` transition.** `expiresAt` is stored but unused; a dead token shows up as a failed post, not an account state change (§10).
- **No post-level "partially published" status.** `Post.status` is never recomputed from target outcomes (§11).
- **No distributed/advisory lock, no timed lease, no backoff cap, no jitter.** Concurrency safety is a single-statement CAS on `claimedAt`; backoff is deterministic doubling (§4, §5).
- **The `cancelled` PostTarget state is declared** (`schema.prisma:264`) **but never set** by any traced code path.
- **`userId`/`ip` are null on worker-emitted audit rows**, and all audit IPs are null unless `TRUST_PROXY=1` (§12).
- **Notifications fire only on permanent failure** (and autopilot review) — not on retries or holds (§13).
