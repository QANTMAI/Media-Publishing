/* ── QANTM taxonomy & legend — the single source of truth for the system's
 *    controlled vocabularies (Build Plan §07; docs/DATA-MAP.md). ──
 *
 * Every fixed set of string values the system stores or compares is declared
 * here ONCE, and derived from the existing config where that config already
 * owns it (platform rules/colors). Nothing here is new invented vocabulary —
 * it consolidates what was previously spread across types.ts, platforms.ts,
 * the Prisma schema comments, and hard-coded string checks, so drift is
 * impossible: the registry is asserted against those sources in the test suite
 * (tests/taxonomy.test.mts).
 *
 * This module is import-safe on both client and server (no DB, no Node-only
 * deps). Server-only vocabularies that need runtime detail (e.g. the full
 * Notification type registry) live next to their code and re-use the keys
 * declared here. */

import { MARK_TO_PLATFORM, PLATFORM_COLORS, PLATFORM_RULES, STATUS_COLORS } from "./platforms";
import type {
  AccountProvenance,
  AccountStatus,
  CalView,
  Lens,
  PlatformId,
  PlatformMark,
  PostStatus,
  PostType,
  TargetState,
} from "./types";

// ───────────────────────────── Platforms ──────────────────────────────────
// The ten platforms the product models. `publishable` is DERIVED from
// PLATFORM_RULES: a platform is publishable exactly when it has a rules entry
// (caption limit etc.) AND a mark→id mapping — i.e. the composer can target it
// and the publisher has an integration. This is the honest "what can the
// system actually do" registry; the other four are modeled (colors, types)
// but not yet integrated.

export interface PlatformDef {
  id: PlatformId;
  mark: PlatformMark;
  name: string;
  /** Calendar/legend color for the platform lens. */
  color: string;
  /** True when the composer can schedule to it and a publisher path exists. */
  publishable: boolean;
}

/** id ↔ mark, kept in lockstep with the type unions and PLATFORM_COLORS. */
const PLATFORM_IDENTITY: ReadonlyArray<{ id: PlatformId; mark: PlatformMark; name: string }> = [
  { id: "instagram", mark: "IG", name: "Instagram" },
  { id: "facebook", mark: "FB", name: "Facebook" },
  { id: "x", mark: "X", name: "X" },
  { id: "linkedin", mark: "IN", name: "LinkedIn" },
  { id: "youtube", mark: "YT", name: "YouTube" },
  { id: "tiktok", mark: "TT", name: "TikTok" },
  { id: "threads", mark: "TH", name: "Threads" },
  { id: "bluesky", mark: "BS", name: "Bluesky" },
  { id: "pinterest", mark: "PN", name: "Pinterest" },
  { id: "gbp", mark: "GB", name: "Google Business" },
];

export const PLATFORMS: readonly PlatformDef[] = PLATFORM_IDENTITY.map((p) => ({
  ...p,
  color: PLATFORM_COLORS[p.mark],
  // Publishable ⇔ has rules AND a mark→id mapping (both are how the app decides
  // it can target the platform).
  publishable: p.id in PLATFORM_RULES && MARK_TO_PLATFORM[p.mark] === p.id,
}));

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
export const PLATFORM_MARKS = PLATFORMS.map((p) => p.mark);
/** The subset the composer/publisher supports today (Wave 1 + TikTok). */
export const PUBLISHABLE_PLATFORM_IDS = PLATFORMS.filter((p) => p.publishable).map((p) => p.id);

const PLATFORM_BY_MARK = new Map(PLATFORMS.map((p) => [p.mark, p]));
const PLATFORM_BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
export const platformByMark = (mark: string): PlatformDef | undefined => PLATFORM_BY_MARK.get(mark as PlatformMark);
export const platformById = (id: string): PlatformDef | undefined => PLATFORM_BY_ID.get(id as PlatformId);
export const isPublishablePlatform = (id: string): boolean => !!platformById(id)?.publishable;

// ──────────────────────── Account status & provenance ─────────────────────
export const ACCOUNT_STATUSES = ["connected", "expiring", "paused", "disconnected"] as const satisfies readonly AccountStatus[];

export const ACCOUNT_PROVENANCE = ["real", "mock", "demo"] as const satisfies readonly AccountProvenance[];

/** True only for a genuine platform grant — the gate for "this can publish for
 * real" and "no not-real tag needed". */
export const isRealProvenance = (p: string | null | undefined): boolean => p === "real";

/** Short UI tag for non-real provenance (empty for real). */
export function provenanceTag(p: AccountProvenance | string | null | undefined): string {
  if (p === "demo") return "demo";
  if (p === "mock") return "mock";
  return "";
}

/** Migration/backfill reference: the historical `label` values and the
 * provenance each maps to. Real connections always used a null label (or a
 * user's own disambiguation label), so only these known markers map to
 * non-real — a custom user label stays "real". */
export const LEGACY_LABEL_PROVENANCE: Record<string, AccountProvenance> = {
  demo: "demo",
  "mock connection": "mock",
  "test (mock)": "mock",
  "test fixture": "mock",
};

// ─────────────────────── Post & target state machine ──────────────────────
// Two related but DISTINCT vocabularies (kept separate on purpose):
//  - POST_STATUSES: the aggregate status stored on Post.
//  - TARGET_STATES: the per-target machine on PostTarget (adds publishing +
//    the terminal cancelled). GET /api/posts serves the target state.
export const POST_STATUSES = ["draft", "scheduled", "published", "failed"] as const satisfies readonly PostStatus[];

export const TARGET_STATES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const satisfies readonly TargetState[];

/** Terminal states — no further transitions, no queue job. */
export const TERMINAL_TARGET_STATES: readonly TargetState[] = ["published", "failed", "cancelled"];
export const isTerminalState = (s: string): boolean => (TERMINAL_TARGET_STATES as readonly string[]).includes(s);

/** Target-state → color, re-exported from platforms.ts so the legend has one
 * home. Covers all six states (the cancelled gap is closed there). */
export const TARGET_STATE_COLORS = STATUS_COLORS;

// ────────────────────────── UI view vocabularies ──────────────────────────
export const LENSES = ["category", "platform", "status"] as const satisfies readonly Lens[];
export const CAL_VIEWS = ["month", "week", "list"] as const satisfies readonly CalView[];
export const POST_TYPES = ["image", "video"] as const satisfies readonly PostType[];

// ──────────────────────────── Notifications ───────────────────────────────
// Keys declared here; the full registry (labels/defaults) lives in
// src/lib/server/notifications.ts and is cross-checked in the tests.
export const NOTIFY_TYPE_KEYS = ["publish_failed", "review_ready"] as const;
export type NotifyTypeKey = (typeof NOTIFY_TYPE_KEYS)[number];
export const NOTIFY_LEVELS = ["info", "warn", "error"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

// ─────────────────────────── Audit action legend ──────────────────────────
// The complete, grouped legend of audit action strings written across the
// codebase (every audit("…") call site). This is the documented vocabulary;
// tests assert the code emits nothing outside it.
export const AUDIT_ACTIONS = {
  auth: [
    "auth.setup",
    "auth.setup.confirmed",
    "auth.setup.throttled",
    "auth.login",
    "auth.login.failed",
    "auth.login.throttled",
    "auth.verify",
    "auth.verify.failed",
    "auth.verify.replayed",
    "auth.verify.throttled",
    "auth.logout",
    "auth.dev_login",
  ],
  account: ["account.connect", "account.connect_failed", "account.disconnect", "account.pause", "account.resume", "account.remove"],
  publish: ["publish.success", "publish.retry", "publish.failed"],
  post: ["post.approve", "post.cancel", "post.discard", "post.edit", "post.reschedule"],
  autopilot: ["autopilot.on", "autopilot.off", "autopilot.mode"],
  asset: ["asset.upload", "asset.transcoded", "asset.transcode_failed", "asset.delete"],
  category: ["category.create", "category.update", "category.delete"],
  credential: ["credential.set", "credential.test", "credential.delete"],
  feed: ["feed.add", "feed.toggle", "feed.delete"],
  notify: ["notify.prefs"],
  metrics: ["metrics.collected", "metrics.rate_limited"],
} as const;

/** Flat set of every registered audit action. */
export const ALL_AUDIT_ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS).flat();
export const isKnownAuditAction = (a: string): boolean => (ALL_AUDIT_ACTIONS as readonly string[]).includes(a);
