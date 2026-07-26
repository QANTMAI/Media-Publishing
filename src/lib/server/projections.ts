import { db } from "./db";

/* ── Projection primitive ──────────────────────────────────────────────────
 * A *projection* turns an authoritative append-only store into a humanized,
 * provenance-cited, READ-ONLY view — never a copy, always computed live,
 * honest-empty when the store is empty. The organizational-memory Episodic and
 * Eval lanes were the first instances; this module extracts the reusable core
 * so any surface (security timeline, per-entity history, activity feed, an
 * exportable report) can project the same audit log through a different lens
 * without duplicating the humanizer.
 *
 * The store here is `AuditEvent` (2,345+ real events). Its metadata "never
 * contains secrets" (guaranteed by audit()), so projected bodies are safe. */

export interface ActivityItem {
  id: string; // the audit event id (provenance)
  action: string; // raw action string (the citation)
  title: string; // humanized label
  detail: string; // short, safe detail from metadata
  ip: string | null;
  occurredAt: string; // ISO
}

// One humanizer, shared by every consumer. Covers content actions AND auth
// (auth is excluded from org memory as noise, but IS the security timeline).
const ACTION_LABEL: Record<string, string> = {
  // content / operations
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
  // security / auth
  "auth.login": "Signed in (password accepted)",
  "auth.login.failed": "Failed sign-in attempt",
  "auth.login.throttled": "Sign-in throttled — too many attempts",
  "auth.verify": "Passed two-factor verification",
  "auth.verify.failed": "Failed a two-factor code",
  "auth.verify.replayed": "Blocked a replayed two-factor code",
  "auth.verify.throttled": "Two-factor verification throttled",
  "auth.setup": "Started account setup",
  "auth.setup.confirmed": "Completed two-factor enrollment",
  "auth.setup.throttled": "Account setup throttled",
  "auth.logout": "Signed out",
  "auth.dev_login": "Signed in via the dev bypass",
};

export function humanizeAuditAction(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Short, safe detail from audit metadata (which never contains secrets). */
export function auditDetail(metadata: string | null): string {
  if (!metadata) return "";
  try {
    const m = JSON.parse(metadata) as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ["platform", "handle", "mode", "category", "provider", "error", "name", "added", "planned", "count"]) {
      if (m[k] != null && m[k] !== "") parts.push(`${k}: ${String(m[k]).slice(0, 80)}`);
    }
    return parts.join(" · ");
  } catch {
    return "";
  }
}

export interface ProjectAuditOpts {
  limit?: number;
  /** Include auth.* events (default false — they're security-timeline only). */
  includeAuth?: boolean;
  /** Only auth.* events (the security lens). */
  onlyAuth?: boolean;
  /** Restrict to specific actions (whitelist). */
  actions?: string[];
  /** Per-entity: keep only events whose metadata contains ANY of these refs
   * (e.g. a postId + its target ids). Powers per-post / per-account history. */
  refs?: string[];
}

/** The reusable audit projection. Returns humanized, cited, read-only
 * ActivityItems — the single source every projected view is built from. */
export async function projectAuditEvents(opts: ProjectAuditOpts = {}): Promise<ActivityItem[]> {
  const where: Record<string, unknown> = {};
  if (opts.onlyAuth) where.action = { startsWith: "auth." };
  else if (!opts.includeAuth) where.NOT = { action: { startsWith: "auth." } };
  if (opts.actions?.length) where.action = { in: opts.actions };
  if (opts.refs?.length) where.OR = opts.refs.filter(Boolean).map((r) => ({ metadata: { contains: r } }));

  const rows = await db.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 40,
    select: { id: true, action: true, ip: true, metadata: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    title: humanizeAuditAction(r.action),
    detail: auditDetail(r.metadata),
    ip: r.ip,
    occurredAt: r.createdAt.toISOString(),
  }));
}
