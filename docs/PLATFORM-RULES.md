# Platform limits — the system rule

> **RULE: every platform limit lives in versioned config, and the same config
> both displays the limit in the UI and enforces it at the API. Hand-written
> numbers in components or copy are forbidden — if a limit isn't in config,
> the platform isn't integrated. Every value carries a verification status
> and source; unverified values are labeled in the UI and must be re-checked
> (or queried at the platform's runtime endpoint) before launch.**

## Where each limit lives

| Config | Enforced by | Displayed by |
|---|---|---|
| `src/lib/platforms.ts` → `PLATFORM_RULES` (caption limits, hashtag guidance, image specs) | `POST /api/posts` (caption length, integrated-platform check) | Composer rules panel + live counter |
| `src/lib/video-specs.ts` → `VIDEO_SPECS` (duration, size, fps, aspect, containers) | `POST /api/posts` (ready videos) **and** the publisher (videos that finished transcoding after scheduling) | Composer rules panel — the `vid` string is **derived** from `VIDEO_SPECS`, never hand-written |
| `src/lib/server/media.ts` (upload MIME allowlists, byte caps) | Presign + complete + the storage door (byte cap signed into the PUT URL) | Upload error messages |

A platform with no `PLATFORM_RULES` entry cannot be scheduled to (422), because
no publisher integration exists for it — the config is the honest registry of
what the system can actually do.

## Current limits

### Captions & images (handoff values — re-verify before launch)

| Platform | Caption limit | Hashtags | Image |
|---|---|---|---|
| Instagram | 2,200 | 30 max | JPG/PNG · 1080px wide · 1:1–4:5 |
| X | 280 | in text | JPG/PNG/WebP/GIF · ≤5MB · up to 4 |
| LinkedIn | 3,000 | 3–5 rec. | JPG/PNG · ≤5MB |
| Facebook | 63,206 | no cap | JPG/PNG |
| YouTube | 5,000 (description) | 15 max | Thumbnail 1280×720 · ≤2MB |
| TikTok | 2,200 | in caption | Photo mode · JPG/PNG |

Status: **from the design handoff — not independently verified.** Verify each
against current platform docs before real-token launch (same process as the
video research below).

### Video (researched July 2026 from official docs — see docs/VIDEO.md for sources)

| Platform | Duration | Max size | FPS | Verified |
|---|---|---|---|---|
| Instagram (Reels API) | 3 s – 15 min | 300 MB | 23–60 | ✔ |
| Facebook | *query `GET /{page}/video_upload_limits` at runtime* | *runtime* | 24–60 | ✘ (runtime endpoint is authoritative) |
| X | 0.5 – 140 s | 512 MB | ≤60 | ✔ |
| LinkedIn | 3 s – 30 min | 500 MB | — | ✘ (codec/fps live in LinkedIn Ads specs) |
| YouTube | ≤12 h (Shorts ≤3 min + ≥1:1 tall) | 256 GB | 24–60 | ✔ |
| TikTok | ≤10 min — *real cap: `creator_info.max_video_post_duration_sec`* | 4 GB | 23–60 | ✘ (per-creator) |

### Uploads (media pipeline)

| Kind | MIME allowlist | Byte cap (signed into the PUT URL) |
|---|---|---|
| Image | jpeg, png, webp, gif | 25 MB |
| Video | mp4, quicktime | 512 MB |

## Changing a limit

1. Edit the config (`platforms.ts` / `video-specs.ts` / `media.ts`) — include
   the source URL and set `verified` honestly.
2. Run `npm test` — the spec suites assert config sanity and that display
   derives from enforcement.
3. Nothing else: no component, route, or publisher code should need touching.
