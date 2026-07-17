/* Per-platform VIDEO publishing constraints — researched July 2026 from the
 * platforms' own documentation (source URLs below, fetched live; nothing
 * assumed). Values marked `verified: false` could not be confirmed on an
 * official page and MUST be re-checked (or queried at runtime where the
 * platform provides an endpoint) before relying on them.
 *
 * This is versioned config (Build Plan §03.2): update the data, not the app. */

export const VIDEO_SPECS_VERSION = "2026-07";

export interface VideoSpec {
  platform: string;
  containers: string[];
  vcodec: string;
  acodec: string;
  maxSizeMB: number;
  minDurationS: number;
  maxDurationS: number;
  fps: { min: number; max: number };
  /** Aspect-ratio bounds as width/height ratios. */
  aspect: { min: number; max: number; recommended: string };
  maxEdgePx: number | null;
  verified: boolean;
  notes: string;
  sources: string[];
}

export const VIDEO_SPECS: Record<string, VideoSpec> = {
  instagram: {
    platform: "instagram",
    containers: ["mp4", "mov"],
    vcodec: "h264|hevc progressive, closed GOP, 4:2:0",
    acodec: "aac ≤48kHz mono/stereo 128kbps",
    maxSizeMB: 300,
    minDurationS: 3,
    maxDurationS: 900, // 15 min (Reels via Graph API)
    fps: { min: 23, max: 60 },
    aspect: { min: 0.01, max: 10, recommended: "9:16" },
    maxEdgePx: 1920, // max horizontal columns
    verified: true,
    notes:
      "Reels container flow: media_type=REELS + video_url (public, no redirects) or resumable upload; " +
      "cover via cover_url or thumb_offset (ms); poll status_code until FINISHED before media_publish. " +
      "moov atom at front, no edit lists. Video VBR ≤25Mbps.",
    sources: [
      "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media",
    ],
  },
  facebook: {
    platform: "facebook",
    containers: ["mp4"],
    vcodec: "h264 (reels also h265/vp9/av1)",
    acodec: "aac-lc 48kHz stereo ≥128kbps (reels spec)",
    maxSizeMB: 1024, // UNVERIFIED numeric cap — query GET /{page-id}/video_upload_limits at runtime
    minDurationS: 3,
    maxDurationS: 1200, // UNVERIFIED — runtime endpoint is authoritative
    fps: { min: 24, max: 60 },
    aspect: { min: 0.5625, max: 1.7778, recommended: "9:16 (Reels) / 16:9 (feed)" },
    maxEdgePx: 1920,
    verified: false,
    notes:
      "Numeric size/duration caps not on current official pages — Meta provides " +
      "GET /{page-id}/video_upload_limits (length, size); use it before upload. " +
      "FB Reels: 3–90s, 1080x1920 rec, 540x960 min, ≤30 API-published reels per 24h.",
    sources: [
      "https://developers.facebook.com/docs/graph-api/video-uploads/",
      "https://developers.facebook.com/docs/graph-api/reference/video-upload-limits/",
      "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
    ],
  },
  x: {
    platform: "x",
    containers: ["mp4", "mov"],
    vcodec: "h264 high profile, yuv420p only",
    acodec: "aac-lc mono/stereo ≤128kbps",
    maxSizeMB: 512,
    minDurationS: 0.5,
    maxDurationS: 140, // tweet_video; amplify_video (promoted) allows 600s
    fps: { min: 1, max: 60 },
    aspect: { min: 1 / 3, max: 3, recommended: "16:9 or 9:16 (720x1280)" },
    maxEdgePx: 1280, // documented bound 32x32–1280x1024; X transcodes larger
    verified: true,
    notes:
      "Chunked upload INIT→APPEND→FINALIZE→STATUS with media_category=tweet_video; " +
      "poll processing_info.state until succeeded. Keep a 720x1280 portrait rendition — " +
      "1080x1920 exceeds the documented resolution bound and gets transcoded down.",
    sources: [
      "https://docs.x.com/x-api/media/quickstart/best-practices",
      "https://docs.x.com/x-api/media/quickstart/media-upload-chunked",
    ],
  },
  linkedin: {
    platform: "linkedin",
    containers: ["mp4"],
    vcodec: "h264 (assumed — API doc defers to LinkedIn Ads specs)",
    acodec: "aac (assumed — not documented at API level)",
    maxSizeMB: 500,
    minDurationS: 3,
    maxDurationS: 1800, // 30 min
    fps: { min: 24, max: 60 }, // UNVERIFIED at API level
    aspect: { min: 0.5625, max: 1.7778, recommended: "1:1 or 16:9" },
    maxEdgePx: 1920,
    verified: false,
    notes:
      "Videos API flow: initializeUpload → PUT 4,194,304-byte parts (capture ETags) → " +
      "finalizeUpload(uploadToken, uploadedPartIds) → poll status until AVAILABLE. " +
      "Min size 75KB. Codec/fps/aspect live in LinkedIn Ads help pages — re-verify before launch.",
    sources: [
      "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api",
    ],
  },
  youtube: {
    platform: "youtube",
    containers: ["mp4", "mov", "webm"],
    vcodec: "h264 high, progressive, closed GOP @ half fps, CABAC, 4:2:0",
    acodec: "aac-lc 48kHz stereo 384kbps (recommended)",
    maxSizeMB: 262144, // 256GB
    minDurationS: 1,
    maxDurationS: 43200, // 12h verified accounts; Shorts classification ≤180s AND aspect ≥1:1 tall
    fps: { min: 24, max: 60 },
    aspect: { min: 0.01, max: 10, recommended: "16:9 (Shorts: 9:16, ≤3min, ≥1:1 tall)" },
    maxEdgePx: null,
    verified: true,
    notes:
      "videos.insert resumable upload, 256GB cap. No Shorts flag — duration ≤3min AND " +
      "square-or-taller aspect auto-classifies as a Short. moov at front, no edit lists. " +
      "SDR 1080p target 8Mbps.",
    sources: [
      "https://developers.google.com/youtube/v3/docs/videos/insert",
      "https://support.google.com/youtube/answer/1722171",
      "https://support.google.com/youtube/answer/15424877",
    ],
  },
  tiktok: {
    platform: "tiktok",
    containers: ["mp4", "webm", "mov"],
    vcodec: "h264 (rec) | h265 | vp8 | vp9",
    acodec: "aac (assumed — not documented in transfer guide)",
    maxSizeMB: 4096,
    minDurationS: 3,
    maxDurationS: 600, // API ceiling — the REAL per-creator cap comes from creator_info.max_video_post_duration_sec
    fps: { min: 23, max: 60 },
    aspect: { min: 0.5, max: 2, recommended: "9:16" }, // UNVERIFIED bounds — resolution limits are the documented constraint
    maxEdgePx: 4096, // 360px min per side
    verified: false,
    notes:
      "Content Posting API: FILE_UPLOAD (chunks 5–64MB, ≤1000, sequential) or PULL_FROM_URL " +
      "(requires verified domain, no redirects, 1h timeout). ALWAYS query creator_info for " +
      "max_video_post_duration_sec before scheduling. Audio codec/bitrate/aspect not documented.",
    sources: ["https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide"],
  },
};

/** Validate a probed video against a platform's spec. Returns problems. */
export function validateVideoForPlatform(
  platform: string,
  probe: { durationS: number; width: number; height: number; fps: number; sizeMB: number },
): string[] {
  const spec = VIDEO_SPECS[platform];
  if (!spec) return [];
  const problems: string[] = [];
  if (probe.sizeMB > spec.maxSizeMB) {
    problems.push(`${Math.round(probe.sizeMB)}MB exceeds the ${spec.platform} cap of ${spec.maxSizeMB}MB`);
  }
  if (probe.durationS < spec.minDurationS) {
    problems.push(`${probe.durationS.toFixed(1)}s is under the ${spec.platform} minimum of ${spec.minDurationS}s`);
  }
  if (probe.durationS > spec.maxDurationS) {
    problems.push(`${Math.round(probe.durationS)}s exceeds the ${spec.platform} maximum of ${spec.maxDurationS}s`);
  }
  const aspect = probe.width / probe.height;
  if (aspect < spec.aspect.min || aspect > spec.aspect.max) {
    problems.push(`aspect ratio ${aspect.toFixed(2)} outside ${spec.platform}'s accepted range`);
  }
  if (probe.fps > spec.fps.max + 0.5) {
    problems.push(`${Math.round(probe.fps)}fps exceeds the ${spec.platform} maximum of ${spec.fps.max}fps`);
  }
  return problems;
}
