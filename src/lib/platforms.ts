import type { Category, Lens, PlatformMark, PlatformRules, PostStatus, PostView } from "./types";

/* ── Platform rules engine (versioned config — Build Plan §03.2) ──
 * Values from the handoff README; confirm against current platform API docs
 * before shipping — these change. */
export const RULES_VERSION = "2026-07";

export const PLATFORM_RULES: Record<string, PlatformRules> = {
  instagram: { id: "instagram", name: "Instagram", mark: "IG", limit: 2200, tags: "30 max", img: "JPG/PNG · 1080px wide · 1:1 to 4:5", vid: "Reels ≤90s · MP4/MOV", best: "4:5 portrait / 9:16 Reels" },
  x:         { id: "x",         name: "X",         mark: "X",  limit: 280,  tags: "no cap (count in text)", img: "JPG/PNG/WebP/GIF · ≤5MB · up to 4", vid: "≤2:20 · MP4 · ≤512MB", best: "16:9 or 1:1" },
  linkedin:  { id: "linkedin",  name: "LinkedIn",  mark: "IN", limit: 3000, tags: "3–5 recommended", img: "JPG/PNG · ≤5MB", vid: "≤10 min · MP4 · ≤5GB", best: "1.91:1 or 1:1" },
  facebook:  { id: "facebook",  name: "Facebook",  mark: "FB", limit: 63206, tags: "no cap", img: "JPG/PNG", vid: "≤240 min · MP4", best: "1.91:1 or 1:1" },
  youtube:   { id: "youtube",   name: "YouTube",   mark: "YT", limit: 5000, tags: "15 max", img: "Thumbnail 1280×720 · ≤2MB", vid: "≤12h / 256GB · MP4/MOV", best: "16:9" },
  tiktok:    { id: "tiktok",    name: "TikTok",    mark: "TT", limit: 2200, tags: "in caption", img: "Photo mode · JPG/PNG", vid: "3s–10 min · MP4/MOV", best: "9:16 vertical" },
};

/** Platforms the composer can publish to today (Wave 1 + TikTok). */
export const COMPOSER_PLATFORMS = Object.keys(PLATFORM_RULES);

export const MARK_TO_PLATFORM: Partial<Record<PlatformMark, string>> = {
  IG: "instagram", X: "x", IN: "linkedin", FB: "facebook", YT: "youtube", TT: "tiktok",
};

/* ── Color lenses (README design tokens) ── */
export const CATEGORY_COLORS: Record<Category, string> = {
  Promo: "#ff563c",
  Educational: "#605d5d",
  "Behind the scenes": "#bab6b6",
  Tutorial: "#2d2b2b",
  Trend: "#ae1800",
  News: "#7c1405",
};

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

export const CATEGORIES: Category[] = [
  "Promo", "Educational", "Behind the scenes", "Tutorial", "Trend", "News",
];

export const HASHTAG_SUGGESTIONS: Record<Category, string[]> = {
  Promo: ["#newdrop", "#shopnow", "#limitededition", "#musthave"],
  Educational: ["#howto", "#tips", "#learnwithme", "#didyouknow"],
  "Behind the scenes": ["#bts", "#studiolife", "#makingof", "#process"],
  Tutorial: ["#tutorial", "#stepbystep", "#guide", "#howto"],
  Trend: ["#trending", "#viral", "#fyp", "#trendalert"],
  News: ["#news", "#update", "#announcement", "#industry"],
};

export const BRAND_HASHTAGS = ["#qantmai", "#creator", "#contentcreator", "#smallbusiness"];

/** Color for a post under the active lens. */
export function postColor(post: PostView, lens: Lens): string {
  if (lens === "category") return CATEGORY_COLORS[post.category] ?? "#605d5d";
  if (lens === "platform") return PLATFORM_COLORS[post.account.mark] ?? "#605d5d";
  return STATUS_COLORS[post.status] ?? "#605d5d";
}
