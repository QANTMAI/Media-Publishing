import type { Lens, PlatformMark, PlatformRules, PostStatus, PostView } from "./types";
import { VIDEO_SPECS } from "./video-specs";

/* ── Platform rules engine (versioned config — Build Plan §03.2) ──
 * SYSTEM RULE (see docs/PLATFORM-RULES.md): every platform limit lives in
 * versioned config, displayed AND enforced from the same source. Video
 * limits derive from the researched VIDEO_SPECS below — never hand-written
 * here, so the composer can't show numbers the API doesn't enforce.
 * Caption/image values are from the design handoff and marked accordingly
 * in the docs; re-verify before relying on them for launch. */
export const RULES_VERSION = "2026-07";

/** Video display string derived from the researched, enforced spec. */
function videoSummary(platform: string): string {
  const s = VIDEO_SPECS[platform];
  if (!s) return "not integrated";
  const dur =
    s.maxDurationS >= 3600
      ? `${Math.round(s.maxDurationS / 3600)}h`
      : s.maxDurationS >= 60
        ? `${Math.round(s.maxDurationS / 60)}min`
        : `${s.maxDurationS}s`;
  const size = s.maxSizeMB >= 1024 ? `${Math.round(s.maxSizeMB / 1024)}GB` : `${s.maxSizeMB}MB`;
  const containers = s.containers
    .map((c) => c.split(" ")[0].toUpperCase())
    .slice(0, 3)
    .join("/");
  return `${s.minDurationS}s–${dur} · ≤${size} · ${containers}${s.verified ? "" : " · unverified"}`;
}

const BASE_RULES: Record<string, Omit<PlatformRules, "vid">> = {
  instagram: { id: "instagram", name: "Instagram", mark: "IG", limit: 2200, tags: "30 max", img: "JPG/PNG · 1080px wide · 1:1 to 4:5", best: "4:5 portrait / 9:16 Reels" },
  x:         { id: "x",         name: "X",         mark: "X",  limit: 280,  tags: "no cap (count in text)", img: "JPG/PNG/WebP/GIF · ≤5MB · up to 4", best: "16:9 or 1:1" },
  linkedin:  { id: "linkedin",  name: "LinkedIn",  mark: "IN", limit: 3000, tags: "3–5 recommended", img: "JPG/PNG · ≤5MB", best: "1.91:1 or 1:1" },
  facebook:  { id: "facebook",  name: "Facebook",  mark: "FB", limit: 63206, tags: "no cap", img: "JPG/PNG", best: "1.91:1 or 1:1" },
  youtube:   { id: "youtube",   name: "YouTube",   mark: "YT", limit: 5000, tags: "15 max", img: "Thumbnail 1280×720 · ≤2MB", best: "16:9" },
  tiktok:    { id: "tiktok",    name: "TikTok",    mark: "TT", limit: 2200, tags: "in caption", img: "Photo mode · JPG/PNG", best: "9:16 vertical" },
};

export const PLATFORM_RULES: Record<string, PlatformRules> = Object.fromEntries(
  Object.entries(BASE_RULES).map(([id, base]) => [id, { ...base, vid: videoSummary(id) }]),
);

/** Platforms the composer can publish to today (Wave 1 + TikTok). */
export const COMPOSER_PLATFORMS = Object.keys(PLATFORM_RULES);

export const MARK_TO_PLATFORM: Partial<Record<PlatformMark, string>> = {
  IG: "instagram", X: "x", IN: "linkedin", FB: "facebook", YT: "youtube", TT: "tiktok",
};

/* ── Default categories (README design tokens) ──
 * The seed source of truth for a new operator's content categories. Categories
 * are editable data (see the Category model): these values are only used to
 * seed defaults on first use and as a fallback color when a post references a
 * category that no longer exists. */
export interface CategorySeed {
  name: string;
  color: string;
  hashtags: string[];
}

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { name: "Promo", color: "#ff563c", hashtags: ["#newdrop", "#shopnow", "#limitededition", "#musthave"] },
  { name: "Educational", color: "#605d5d", hashtags: ["#howto", "#tips", "#learnwithme", "#didyouknow"] },
  { name: "Behind the scenes", color: "#bab6b6", hashtags: ["#bts", "#studiolife", "#makingof", "#process"] },
  { name: "Tutorial", color: "#2d2b2b", hashtags: ["#tutorial", "#stepbystep", "#guide", "#howto"] },
  { name: "Trend", color: "#ae1800", hashtags: ["#trending", "#viral", "#fyp", "#trendalert"] },
  { name: "News", color: "#7c1405", hashtags: ["#news", "#update", "#announcement", "#industry"] },
];

/** Fallback color map derived from the defaults — used when no live category
 * resolver is supplied (e.g. unit tests) or a category was deleted. */
export const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((c) => [c.name, c.color]),
);

/** Neutral color for a category with no known color. */
export const CATEGORY_FALLBACK_COLOR = "#605d5d";

/** Palette cycled through when the operator creates a category without picking
 * a color (composer ＋New). Distinct from the neutral fallback. */
export const CATEGORY_PALETTE = [
  "#ff563c", "#ae1800", "#2f54d1", "#0a7d55", "#7c1405", "#605d5d", "#c94b39", "#444141",
];

export const PLATFORM_COLORS: Record<PlatformMark, string> = {
  IG: "#ff563c", FB: "#7d7979", X: "#201e1d", IN: "#605d5d", YT: "#ae1800",
  TT: "#2d2b2b", TH: "#444141", BS: "#9b9797", PN: "#c94b39", GB: "#605d5d",
};

export const STATUS_COLORS: Record<PostStatus, string> = {
  draft: "#bab6b6",
  scheduled: "#605d5d",
  publishing: "#2f54d1",
  published: "#ae1800",
  failed: "#ec3013",
};

/** Default category names — fallback list when live categories aren't loaded. */
export const CATEGORIES: string[] = DEFAULT_CATEGORIES.map((c) => c.name);

/** Default hashtag suggestions by category name — fallback for the composer. */
export const HASHTAG_SUGGESTIONS: Record<string, string[]> = Object.fromEntries(
  DEFAULT_CATEGORIES.map((c) => [c.name, c.hashtags]),
);

export const BRAND_HASHTAGS = ["#qantmai", "#creator", "#contentcreator", "#smallbusiness"];

/** Color for a post under the active lens. Pass `colorForCategory` (from the
 * operator's live categories) so a renamed/recolored category shows correctly;
 * without it, falls back to the seeded default colors. */
export function postColor(
  post: PostView,
  lens: Lens,
  colorForCategory?: (name: string) => string | undefined,
): string {
  if (lens === "category") {
    return colorForCategory?.(post.category) ?? CATEGORY_COLORS[post.category] ?? CATEGORY_FALLBACK_COLOR;
  }
  if (lens === "platform") return PLATFORM_COLORS[post.account.mark] ?? CATEGORY_FALLBACK_COLOR;
  return STATUS_COLORS[post.status] ?? CATEGORY_FALLBACK_COLOR;
}
