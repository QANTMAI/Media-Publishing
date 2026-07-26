import { db } from "./db";
import type { MemoryView } from "./memory";

/* Episodic & Eval lanes are PROJECTIONS, not stored copies — read live from the
 * existing stores (the 2,345-event AuditEvent log, PostTarget outcomes,
 * MetricSnapshot) and shaped as read-only MemoryViews with real provenance
 * links. Nothing here fabricates: counts and rates come straight from the DB;
 * an empty store yields an honest empty projection. */

// Human labels for audit actions (Episodic feed). Auth events are security
// noise, not organizational memory, and are excluded below.
const ACTION_LABEL: Record<string, string> = {
  "post.schedule": "Scheduled a post",
  "post.draft": "Saved a draft",
  "post.approve": "Approved a post for publishing",
  "post.cancel": "Cancelled a post",
  "post.discard": "Discarded a draft",
  "post.edit": "Edited a post",
  "post.reschedule": "Rescheduled a post",
  "publish.success": "Published a post",
  "publish.failed": "A post failed to publish",
  "publish.retry": "Retried a publish",
  "publish.pause_all": "Paused all publishing (kill switch)",
  "publish.resume_all": "Resumed publishing",
  "account.connect": "Connected an account",
  "account.connect_failed": "An account connection failed",
  "account.disconnect": "Disconnected an account",
  "account.pause": "Paused an account",
  "account.resume": "Resumed an account",
  "account.remove": "Removed an account",
  "asset.upload": "Uploaded media",
  "asset.transcoded": "Transcoded a video",
  "asset.transcode_failed": "A video transcode failed",
  "asset.delete": "Deleted media",
  "category.create": "Created a category",
  "category.update": "Updated a category",
  "category.delete": "Deleted a category",
  "credential.set": "Saved an API key",
  "credential.test": "Tested an API key",
  "credential.delete": "Removed an API key",
  "feed.add": "Added a trend source",
  "feed.toggle": "Toggled a trend source",
  "feed.delete": "Removed a trend source",
  "notify.prefs": "Updated notification settings",
  "autopilot.on": "Turned Autopilot on",
  "autopilot.off": "Turned Autopilot off",
  "autopilot.mode": "Changed the Autopilot delivery mode",
  "memory.create": "Recorded a memory",
  "memory.update": "Updated a memory",
  "memory.archive": "Archived a memory",
  "memory.link": "Cited evidence on a memory",
  "memory.seed": "Seeded memory from the operating rules",
  "metrics.collected": "Collected post metrics",
  "metrics.rate_limited": "Metrics collection hit a rate limit",
};

/** Actions excluded from the episodic feed: routine auth (security-log noise). */
const EPISODIC_EXCLUDE = /^auth\./;

function humanize(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Short, safe detail from audit metadata (which never contains secrets). */
function detailFrom(metadata: string | null): string {
  if (!metadata) return "";
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ["platform", "handle", "mode", "category", "provider", "error", "name", "added", "planned"]) {
      if (m[k] != null && m[k] !== "") parts.push(`${k}: ${String(m[k]).slice(0, 80)}`);
    }
    return parts.join(" · ");
  } catch {
    return "";
  }
}

function iso(d: Date): string {
  return d.toISOString();
}

/** Episodic projection — recent meaningful actions from the audit log. */
export async function projectEpisodic(limit = 40): Promise<MemoryView[]> {
  const rows = await db.auditEvent.findMany({
    where: { NOT: { action: { startsWith: "auth." } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, metadata: true, createdAt: true },
  });
  return rows
    .filter((r) => !EPISODIC_EXCLUDE.test(r.action))
    .map((r) => {
      const detail = detailFrom(r.metadata);
      return {
        id: `ep_${r.id}`,
        lane: "episodic",
        title: humanize(r.action),
        body: detail || `(${r.action})`,
        status: "active",
        confidence: null,
        tags: [r.action.split(".")[0]],
        reviewedAt: null,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.createdAt),
        links: [{ id: `epl_${r.id}`, kind: "audit", ref: r.id, note: r.action }],
        derived: true,
      } satisfies MemoryView;
    });
}

/** Eval projection — real publishing outcomes + metric aggregates. Honest
 * empty when nothing has published / no metrics exist. */
export async function projectEval(): Promise<MemoryView[]> {
  const byState = await db.postTarget.groupBy({ by: ["state"], _count: true });
  const count = (s: string) => byState.find((r) => r.state === s)?._count ?? 0;
  const published = count("published");
  const failed = count("failed");
  const scheduled = count("scheduled");
  const out: MemoryView[] = [];

  if (published + failed > 0) {
    const rate = Math.round((published / (published + failed)) * 100);
    out.push({
      id: "ev_outcomes",
      lane: "eval",
      title: "Publishing outcomes",
      body: `${published} published, ${failed} failed, ${scheduled} scheduled. Success rate: ${rate}% of attempted publishes.`,
      status: "active",
      confidence: null,
      tags: ["outcomes"],
      reviewedAt: null,
      createdAt: iso(new Date(0)),
      updatedAt: iso(new Date()),
      links: [{ id: "evl_outcomes", kind: "doc", ref: "PostTarget.state (live)", note: "derived from the queue" }],
      derived: true,
    });
  }

  // Metric aggregate — only from the latest snapshot per target (real
  // API responses; mock publishes never get snapshots).
  const snaps = await db.metricSnapshot.findMany({
    orderBy: { fetchedAt: "desc" },
    select: { postTargetId: true, views: true, reach: true, likes: true, comments: true, shares: true },
  });
  if (snaps.length) {
    const latest = new Map<string, (typeof snaps)[number]>();
    for (const s of snaps) if (!latest.has(s.postTargetId)) latest.set(s.postTargetId, s);
    const sum = (k: "views" | "reach" | "likes" | "comments" | "shares") =>
      [...latest.values()].reduce((a, s) => a + (s[k] ?? 0), 0);
    out.push({
      id: "ev_metrics",
      lane: "eval",
      title: "Audience performance (latest snapshots)",
      body: `Across ${latest.size} post(s): ${sum("views")} views, ${sum("reach")} reach, ${sum("likes")} likes, ${sum("comments")} comments, ${sum("shares")} shares.`,
      status: "active",
      confidence: null,
      tags: ["metrics"],
      reviewedAt: null,
      createdAt: iso(new Date(0)),
      updatedAt: iso(new Date()),
      links: [{ id: "evl_metrics", kind: "metric", ref: `${latest.size} MetricSnapshot rows`, note: "real API responses only" }],
      derived: true,
    });
  }

  return out;
}
