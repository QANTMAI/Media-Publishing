# Video pipeline

Researched July 2026 against live official documentation — every value below
carries its source; anything the platforms don't publish is marked
**unverified** and must be re-checked (or queried at runtime) before launch.
The machine-readable version of this table lives in
`src/lib/server/video-specs.ts` and is what the API validates against.

## Platform limits (API-level, which differ from in-app limits)

| | Container | Video codec | Audio | Max size | Duration | Aspect | FPS |
|---|---|---|---|---|---|---|---|
| **Instagram Reels** (Graph API) | MP4/MOV, moov at front, no edit lists | H.264/HEVC, closed GOP, 4:2:0, ≤25Mbps VBR | AAC ≤48kHz ≤128kbps | 300 MB | 3 s – 15 min | 0.01:1–10:1 (9:16 rec) | 23–60 |
| **Facebook Pages** | MP4 | H.264 (+H.265/VP9/AV1 for Reels) | AAC-LC 48kHz | *query `GET /{page}/video_upload_limits`* | *runtime query*; Reels 3–90 s | Reels 9:16 | 24–60 |
| **X** | MP4/MOV | H.264 High, yuv420p only | AAC-LC ≤128k | 512 MB | 0.5–140 s (amplify 10 min) | 1:3–3:1 | ≤60 |
| **LinkedIn** | MP4 | *unverified (Ads specs)* | *unverified* | 500 MB (schema 5 GB) | 3 s – 30 min | *unverified* | *unverified* |
| **YouTube** | MP4 rec (+many) | H.264 High, CABAC, closed GOP | AAC-LC 48kHz 384k rec | 256 GB | ≤12 h; **Shorts: ≤3 min AND ≥1:1 tall** | any | 24–60 |
| **TikTok** (Content Posting API) | MP4/WebM/MOV | H.264 rec | *unverified* | 4 GB | ≤10 min — **real cap: query `creator_info.max_video_post_duration_sec`** | *unverified* | 23–60 |

Key API quirks found in research:
- **IG Reels**: `media_type=REELS` container + `video_url` (public, no
  redirects, Meta's servers fetch it) or resumable upload; `cover_url` /
  `thumb_offset` for the cover; **async** — poll `status_code` until
  `FINISHED` before `media_publish`. Implemented in `publisher.ts`.
- **Facebook**: numeric caps aren't on current official pages — Meta provides
  a per-page runtime endpoint (`video_upload_limits`); FB Reels are capped at
  30 API-published per rolling 24h.
- **X**: chunked INIT→APPEND→FINALIZE→STATUS with `media_category`; documented
  resolution bound is 1280×1024, so we keep a dedicated **720×1280** rendition
  to avoid X re-transcoding a 1080×1920 master.
- **YouTube Shorts**: no API flag — duration ≤3 min + square-or-taller aspect
  auto-classifies (uploads on/after Oct 15 2024).
- **TikTok**: per-creator duration cap must be read from Query Creator Info;
  `PULL_FROM_URL` requires a domain-verified URL, no redirects, 1h timeout.

Sources: developers.facebook.com (IG media reference, video-uploads,
video_upload_limits, reels-publishing) · docs.x.com (media best-practices,
chunked upload) · learn.microsoft.com (LinkedIn Videos API) ·
developers.google.com + support.google.com (videos.insert, encoding specs,
Shorts) · developers.tiktok.com (content-posting media transfer guide).

## Encode plan (implemented in `src/lib/server/video.ts`)

One ffmpeg invocation per asset — decode once, encode all renditions
concurrently (`split` fan-out; measured faster than serial invocations on
this hardware, and the blurred-background chain is computed once):

| Rendition | Size | Fit | Serves |
|---|---|---|---|
| `vertical` | 1080×1920 | blurred-background pad | IG Reels, FB Reels, TikTok, Shorts |
| `square` | 1080×1080 | center crop-to-fill | feeds |
| `landscape` | 1920×1080 | letterbox pad | YouTube, feeds |
| `xvertical` | 720×1280 | letterbox pad | X (documented 1280×1024 bound) |
| `cover.jpg` | ≤1080w | scene-aware (`thumbnail` filter) | Reels cover, library thumb |

Settings, each justified by the research:
- **libx264, `-preset veryfast`, `-crf 18`** — platforms re-encode uploads, so
  the master must be clean per bit: software x264 beats hardware encoders on
  quality-per-bit; `veryfast` gains ~73% throughput over `medium` for <1 VMAF
  point; CRF 18 sits at the visually-lossless end for re-compression headroom.
- **`-profile:v high` + `yuv420p`** — YouTube's spec (High, CABAC, 4:2:0) and
  X's yuv420p-only requirement; High@4.0 decodes everywhere.
- **2 s closed GOP** (`-g 2×fps -keyint_min 2×fps -sc_threshold 0`).
- **`aac 192k 48kHz`** — native encoder (static builds have no libfdk); above
  Meta's 128k floor, meets the 48kHz specs; loudness normalization skipped
  (platforms normalize to ≈-14 LUFS themselves and only ever turn it down).
- **`-movflags +faststart`** — moov at front, required by Meta and
  recommended by YouTube.
- **No hardware encoding** — the Linux static build in production has no
  VideoToolbox/NVENC, and quality-per-bit favors x264 anyway.

Transcodes run in a dedicated worker loop (10s poll) separate from the
publish queue — a long ffmpeg run never delays a scheduled post. Assets are
claimed atomically (`processingStartedAt`), with stale-claim recovery, so
multiple workers never transcode the same asset. Failures store the ffmpeg
error on the asset and surface in the Library.

**Not yet built:** auto-captions (speech-to-text) and manual trim — the rest
of T-302. Instagram Reels via mock tokens publish end-to-end today; real
tokens additionally need `PUBLIC_ORIGIN`.
