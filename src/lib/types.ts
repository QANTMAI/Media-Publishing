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

/** One connected profile. Many rows may share the same platform. */
export interface SocialAccount {
  id: string;
  platform: PlatformId;
  name: string;
  mark: PlatformMark;
  handle: string;
  status: AccountStatus;
  label?: string | null;
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

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

/** One post target as served by GET /api/posts — the unit the calendar,
 * dashboard, and dialog all render. */
export interface PostView {
  id: string;
  postId: string;
  caption: string;
  category: Category;
  status: PostStatus;
  scheduledAt: string | null; // ISO; null for drafts never scheduled
  permalink: string | null;
  error: string | null;
  autopilot: boolean;
  demo: boolean; // targets a seeded demo account, not a real connection
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
