import type { Category, Lens, PlatformMark, PlatformRules, PostStatus, PostView } from "./types";
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
