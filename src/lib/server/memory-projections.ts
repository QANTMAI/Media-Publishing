import { db } from "./db";
import type { MemoryView } from "./memory";
import { projectAuditEvents } from "./projections";

/* Episodic & Eval lanes are PROJECTIONS, not stored copies — read live from the
 * existing stores (the 2,345-event AuditEvent log, PostTarget outcomes,
 * MetricSnapshot) and shaped as read-only MemoryViews with real provenance
 * links. Nothing here fabricates: counts and rates come straight from the DB;
 * an empty store yields an honest empty projection.
 *
 * Episodic reuses the shared audit projection primitive (projections.ts) — the
 * same humanizer that powers the security timeline and per-entity history. */

function iso(d: Date): string {
  return d.toISOString();
}

/** Episodic projection — recent meaningful actions from the audit log
 * (auth noise excluded), shaped as read-only cited MemoryViews. */
export async function projectEpisodic(limit = 40): Promise<MemoryView[]> {
  const events = await projectAuditEvents({ limit }); // excludes auth.* by default
  return events.map((e) => ({
    id: `ep_${e.id}`,
    lane: "episodic",
    title: e.title,
    body: e.detail || `(${e.action})`,
    status: "active",
    confidence: null,
    tags: [e.action.split(".")[0]],
    reviewedAt: null,
    createdAt: e.occurredAt,
    updatedAt: e.occurredAt,
    links: [{ id: `epl_${e.id}`, kind: "audit", ref: e.id, note: e.action }],
    derived: true,
  }));
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
