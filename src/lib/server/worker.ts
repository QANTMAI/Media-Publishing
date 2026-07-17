/* Publisher worker (T-204): polls the PublishJob table for due jobs and
 * publishes them. The queue is the database — durable, transactional, and
 * right-sized for a single-operator portal (the Redis/BullMQ swap is a
 * drop-in later; the claim/backoff semantics here are the contract).
 *
 * Guarantees:
 *  - atomic claim (updateMany with claimedAt=null guard) → no double publish
 *    even with multiple worker processes;
 *  - exponential backoff retries (1m, 2m, 4m…) up to MAX_ATTEMPTS;
 *  - PermanentError fails the target immediately;
 *  - the kill switch holds the whole queue; paused accounts hold their jobs;
 *  - crash recovery: claims older than STALE_CLAIM_MS are re-eligible. */

import { db } from "./db";
import { publishTarget, PermanentError } from "./publisher";
import { killSwitchOn } from "./settings";
import { audit } from "./audit";
import { notify } from "./notifications";
import { sweepOrphanUploads } from "./sweep";
import { processNextVideo } from "./video";
import { collectMetricsCycle } from "./insights";
import { pollFeeds } from "./feeds";

const POLL_MS = 15_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 60_000;
const STALE_CLAIM_MS = 10 * 60_000;
const BATCH = 10;

export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

/** One polling cycle. Exported for tests; the interval loop just calls it. */
export async function runQueueCycle(now = new Date()): Promise<{ processed: number }> {
  if (await killSwitchOn()) return { processed: 0 };

  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const due = await db.publishJob.findMany({
    where: {
      completedAt: null,
      runAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
    },
    orderBy: { runAt: "asc" },
    take: BATCH,
  });

  let processed = 0;
  for (const job of due) {
    // Atomic claim — loses gracefully if another worker got here first.
    const claim = await db.publishJob.updateMany({
      where: { id: job.id, completedAt: null, claimedAt: job.claimedAt },
      data: { claimedAt: now },
    });
    if (claim.count === 0) continue;
    processed += 1;
    await processJob(job.id, job.postTargetId, job.attempts, now);
  }
  return { processed };
}

async function processJob(jobId: string, postTargetId: string, attempts: number, now: Date) {
  await db.postTarget.update({ where: { id: postTargetId }, data: { state: "publishing" } }).catch(() => {});

  // Phase 1: the external publish. Only errors thrown HERE are publish
  // failures eligible for retry/permanent classification.
  let permalink: string;
  let externalMediaId: string | null;
  try {
    ({ permalink, externalMediaId } = await publishTarget(postTargetId));
  } catch (err) {
    await recordFailure(jobId, postTargetId, attempts, now, err);
    return;
  }

  // Phase 2: bookkeeping. The post IS live now — a DB hiccup here must never
  // be classified as a publish failure (that retry path would double-post).
  // Record the target first (it's the publisher's idempotency marker), then
  // close the job; retry briefly on transient DB errors (e.g. SQLITE_BUSY).
  for (let i = 0; i < 3; i++) {
    try {
      await db.postTarget.update({
        where: { id: postTargetId },
        data: { state: "published", permalink, externalMediaId, error: null },
      });
      await db.publishJob.update({ where: { id: jobId }, data: { completedAt: new Date(), lastError: null } });
      await audit("publish.success", { metadata: { postTargetId, permalink } });
      return;
    } catch (err) {
      if (i === 2) {
        // Leave the job claimed: the stale-claim reclaim will re-run it, and
        // the publisher's published-state check makes that re-run a no-op
        // once the target write above has landed.
        console.error("CRITICAL: published but bookkeeping failed", { postTargetId, permalink, err });
        return;
      }
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

async function recordFailure(jobId: string, postTargetId: string, attempts: number, now: Date, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  {

    if (message === "Account is paused") {
      // Hold, don't burn an attempt: recheck when the account may be resumed.
      await db.$transaction([
        db.publishJob.update({
          where: { id: jobId },
          data: { runAt: new Date(now.getTime() + 5 * 60_000), claimedAt: null, lastError: "held: account paused" },
        }),
        db.postTarget.update({ where: { id: postTargetId }, data: { state: "scheduled" } }),
      ]);
      return;
    }

    const nextAttempts = attempts + 1;
    const permanent = err instanceof PermanentError || nextAttempts >= MAX_ATTEMPTS;

    if (permanent) {
      await db.$transaction([
        db.publishJob.update({
          where: { id: jobId },
          data: { completedAt: new Date(), attempts: nextAttempts, lastError: message },
        }),
        db.postTarget.update({ where: { id: postTargetId }, data: { state: "failed", error: message } }),
      ]);
      await audit("publish.failed", { metadata: { postTargetId, error: message.slice(0, 300) } });
      // Notify the operator — a broken publish must never be silent. Look up
      // the owner + account for a specific message.
      const t = await db.postTarget
        .findUnique({ where: { id: postTargetId }, include: { post: { select: { userId: true } }, account: { select: { name: true, handle: true } } } })
        .catch(() => null);
      if (t) {
        await notify(t.post.userId, {
          type: "publish_failed",
          title: `Post to ${t.account.name} failed`,
          body: `${t.account.handle}: ${message.slice(0, 300)}`,
          link: "/dashboard",
          metadata: { postTargetId },
        });
      }
    } else {
      await db.$transaction([
        db.publishJob.update({
          where: { id: jobId },
          data: {
            attempts: nextAttempts,
            runAt: new Date(now.getTime() + backoffMs(nextAttempts)),
            claimedAt: null,
            lastError: message,
          },
        }),
        db.postTarget.update({ where: { id: postTargetId }, data: { state: "scheduled", error: message } }),
      ]);
      await audit("publish.retry", { metadata: { postTargetId, attempt: nextAttempts, error: message.slice(0, 300) } });
    }
  }
}

/** Start the polling loops once per process (hot-reload safe).
 * Two independent loops: publish jobs (fast, network-bound) and media
 * transcodes (slow, CPU-bound) — a 10-minute ffmpeg run must never delay
 * a scheduled publish. */
export function startWorker() {
  const g = globalThis as unknown as {
    __qantmWorker?: ReturnType<typeof setInterval>;
    __qantmWorkerBusy?: boolean;
    __qantmMedia?: ReturnType<typeof setInterval>;
    __qantmMediaBusy?: boolean;
  };
  if (g.__qantmWorker) return;

  g.__qantmMedia = setInterval(async () => {
    if (g.__qantmMediaBusy) return;
    g.__qantmMediaBusy = true;
    try {
      // Drain the pending-video queue one asset at a time (single ffmpeg at
      // once — it already parallelizes across encoder threads).
      while (await processNextVideo()) {
        /* keep going until empty */
      }
    } catch (err) {
      console.error("media worker cycle failed", err);
    } finally {
      g.__qantmMediaBusy = false;
    }
  }, 10_000);
  g.__qantmMedia.unref?.();
  let cycles = 0;
  g.__qantmWorker = setInterval(async () => {
    // Re-entrancy guard: a slow cycle (network-bound publishes) must not
    // overlap the next tick.
    if (g.__qantmWorkerBusy) return;
    g.__qantmWorkerBusy = true;
    try {
      await runQueueCycle();
      // Hourly housekeeping: clear uploads that never completed.
      if (cycles % 240 === 0) {
        await sweepOrphanUploads().catch((err) => console.error("orphan sweep failed", err));
      }
      // Metrics pulls every 6h (IG insight data lags up to 48h — polling
      // faster buys nothing), first run ~5min after boot.
      if (cycles % 1440 === 20) {
        await collectMetricsCycle().catch((err) => console.error("metrics cycle failed", err));
      }
      // Trend/RSS feeds every ~3h, first run ~2.5min after boot. Matches the
      // "auto every 3h" the trending surface advertises.
      if (cycles % 720 === 10) {
        await pollFeeds().catch((err) => console.error("feed poll failed", err));
      }
      cycles += 1;
    } catch (err) {
      console.error("worker cycle failed", err);
    } finally {
      g.__qantmWorkerBusy = false;
    }
  }, POLL_MS);
  // Don't keep a dying process alive just for the poller.
  g.__qantmWorker.unref?.();
  console.log(`[worker] publish queue polling every ${POLL_MS / 1000}s`);
}
