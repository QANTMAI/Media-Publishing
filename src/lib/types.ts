/* Core domain types — mirror Build Plan §07 data model so a real API can slot
 * in underneath later (SocialAccount, Post, PostTarget, Asset, …). */

export type PlatformId =
  | "instagram"
  | "x"
  | "linkedin"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "threads"
  | "bluesky"
  | "pinterest"
  | "gbp";

export type PlatformMark =
  | "IG" | "X" | "IN" | "FB" | "YT" | "TT" | "TH" | "BS" | "PN" | "GB";

export type AccountStatus = "connected" | "expiring" | "paused" | "disconnected";

/** Data provenance for an account (and the posts targeting it). First-class,
 * not inferred from the user-facing `label`. Anything other than "real" is a
 * simulated/sample connection that never reaches a live platform. */
export type AccountProvenance = "real" | "mock" | "demo";

/** One connected profile. Many rows may share the same platform. */
export interface SocialAccount {
  id: string;
  platform: PlatformId;
  name: string;
  mark: PlatformMark;
  handle: string;
  status: AccountStatus;
  label?: string | null;
  /** "real" | "mock" | "demo" — see AccountProvenance. */
  provenance?: AccountProvenance;
  /** How many post targets reference this account (drives the Remove confirm). */
  postCount?: number;
}

/** A content category is now editable operator data, so its name is a free
 * string (validated server-side), not a fixed union. */
export type Category = string;

/** One operator-defined content category, as served by GET /api/categories. */
export interface CategoryDef {
  id: string;
  name: string;
  color: string;
  hashtags: string[];
  sortOrder: number;
}

/** One trending/RSS item, as served by GET /api/feeds. */
export interface FeedItemView {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null;
}

/** One notification, as served by GET /api/notifications. */
export interface NotificationView {
  id: string;
  type: string;
  level: string; // info | warn | error
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  emailed: boolean;
  createdAt: string;
}

/** Aggregate status of a Post (across its targets). */
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

/** The full PostTarget state machine — a superset of PostStatus that adds the
 * terminal `cancelled` state. This is what GET /api/posts serves per target,
 * so the calendar/dashboard must handle all six. */
export type TargetState = PostStatus | "cancelled";

/** One post target as served by GET /api/posts — the unit the calendar,
 * dashboard, and dialog all render. */
export interface PostView {
  id: string;
  postId: string;
  caption: string;
  category: Category;
  status: TargetState;
  scheduledAt: string | null; // ISO; null for drafts never scheduled
  permalink: string | null;
  error: string | null;
  autopilot: boolean;
  /** Provenance of the targeted account: "real" reaches a live platform;
   * "mock"/"demo" never do and must be flagged in the UI. */
  provenance: AccountProvenance;
  assetIds: string[];
  account: {
    id: string;
    platform: PlatformId;
    name: string;
    mark: PlatformMark;
    handle: string;
  };
}

export type PostType = "image" | "video";
export type CalView = "month" | "week" | "list";
export type Lens = "category" | "platform" | "status";

/** Publishing rules for one platform — editable config, not hard-coded logic. */
export interface PlatformRules {
  id: PlatformId;
  name: string;
  mark: PlatformMark;
  limit: number; // caption character limit
  tags: string;
  img: string;
  vid: string;
  best: string;
}
