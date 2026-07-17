/* Video transcode engine (T-302) — settings derived from researched, cited
 * sources (see docs/VIDEO.md): platforms re-encode uploads, so the master
 * renditions are H.264 High yuv420p at CRF 18 (visually-lossless headroom),
 * x264 `veryfast` (~73% throughput gain vs medium for <1 VMAF point), 2s
 * closed GOP, AAC 192k/48kHz, faststart moov. All renditions encode in ONE
 * ffmpeg invocation (decode once, encode N — measured faster than serial
 * invocations on this hardware).
 *
 * Renditions:
 *  - vertical  1080x1920 (9:16)  — IG Reels / FB Reels / TikTok / Shorts;
 *                                  blurred-background pad (standard social look)
 *  - square    1080x1080 (1:1)   — feed; center crop-to-fill
 *  - landscape 1920x1080 (16:9)  — YouTube/feed; letterbox pad
 *  - xvertical  720x1280 (9:16)  — X documents a 1280x1024 bound; a dedicated
 *                                  720x1280 rendition avoids X re-transcoding
 *  - cover.jpg — scene-aware representative frame (ffmpeg `thumbnail` filter)
 *
 * Runs ONLY in the media worker, never in a request. libx264 + native aac are
 * used (not VideoToolbox): the static Linux build used in production has no
 * hardware encoders, and software x264 wins quality-per-bit regardless. */

import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { db } from "./db";
import { putObject, storagePathFor } from "./storage";
import { audit } from "./audit";

const execFileP = promisify(execFile);

const TRANSCODE_TIMEOUT_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 60_000;

export interface VideoProbe {
  durationS: number;
  width: number;
  height: number;
  fps: number;
  vcodec: string;
  sizeBytes: number;
}

/** ffprobe → JSON (flags verified against the bundled ffprobe-static build). */
export async function probeVideo(absPath: string): Promise<VideoProbe> {
  const { stdout } = await execFileP(
    ffprobeStatic.path,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
    format?: { duration?: string; size?: string };
  };
  const v = data.streams?.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error("No video stream found — corrupt or unsupported file");
  const [num, den] = (v.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fps = den ? num / den : 30;
  const durationS = Number(data.format?.duration ?? v.duration ?? 0);
  if (!durationS || !Number.isFinite(durationS)) throw new Error("Could not read video duration");
  return {
    durationS,
    width: v.width,
    height: v.height,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    vcodec: v.codec_name ?? "unknown",
    sizeBytes: Number(data.format?.size ?? 0),
  };
}

export interface RenditionSpec {
  name: "vertical" | "square" | "landscape" | "xvertical";
  filter: string;
  level: string;
}

/** Filtergraphs per the researched patterns (lanczos downscale; blurred-pad
 * for 9:16; crop-to-fill for 1:1; letterbox for 16:9). */
export const RENDITIONS: RenditionSpec[] = [
  {
    name: "vertical",
    filter:
      "split=2[bg][fgs];" +
      "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bgb];" +
      "[fgs]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];" +
      "[bgb][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p",
    level: "4.0",
  },
  {
    name: "square",
    filter: "crop='min(iw,ih)':'min(iw,ih)',scale=1080:1080:flags=lanczos,format=yuv420p",
    level: "4.0",
  },
  {
    name: "landscape",
    filter:
      "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    level: "4.0",
  },
  {
    name: "xvertical",
    filter:
      "scale=720:1280:force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=720:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
    level: "3.1",
  },
];

/** Build the single-invocation argument list: decode once, encode all
 * renditions concurrently. Exported pure for unit testing. */
export function buildTranscodeArgs(inputAbs: string, outDir: string, fps: number): string[] {
  const gop = String(Math.round(Math.max(1, Math.min(fps, 60)) * 2)); // 2s closed GOP
  const splits = RENDITIONS.map((_, i) => `[s${i}]`).join("");
  const graph = [
    `[0:v]split=${RENDITIONS.length}${splits}`,
    ...RENDITIONS.map((r, i) => `[s${i}]${r.filter}[v${r.name}]`),
  ].join(";");

  const args = ["-y", "-i", inputAbs, "-filter_complex", graph];
  for (const r of RENDITIONS) {
    args.push(
      "-map", `[v${r.name}]`,
      "-map", "0:a?", // tolerate silent sources
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-profile:v", "high",
      "-level", r.level,
      "-g", gop,
      "-keyint_min", gop,
      "-sc_threshold", "0",
      "-r", String(Math.min(Math.round(fps) || 30, 60)), // platforms cap at 60fps
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-movflags", "+faststart",
      path.join(outDir, `${r.name}.mp4`),
    );
  }
  return args;
}

/** Cover frame: scene-aware representative frame via the `thumbnail` filter. */
export function buildCoverArgs(inputAbs: string, outAbs: string): string[] {
  return [
    "-y", "-ss", "1", "-i", inputAbs,
    "-vf", "thumbnail=n=120,scale='min(1080,iw)':-2:flags=lanczos",
    "-frames:v", "1", "-q:v", "2",
    outAbs,
  ];
}

const STALE_CLAIM_MS = 45 * 60_000; // > transcode timeout — crashed claims re-eligible

/** Process ONE pending video asset end to end. Returns false when the queue
 * of pending videos is empty. Claim is atomic (same pattern as PublishJob),
 * so multiple worker processes never transcode the same asset twice. */
export async function processNextVideo(): Promise<boolean> {
  const candidate = await db.asset.findFirst({
    where: {
      type: "video",
      status: "processing",
      OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;

  const claim = await db.asset.updateMany({
    where: { id: candidate.id, status: "processing", processingStartedAt: candidate.processingStartedAt },
    data: { processingStartedAt: new Date() },
  });
  if (claim.count === 0) return true; // another worker got it — look again next cycle

  const asset = candidate;

  // NOTE: local storage adapter — inputs are readable in place. The S3
  // adapter downloads to a temp file here instead; everything below is
  // adapter-agnostic (temp outputs → putObject).
  const inputAbs = storagePathFor(asset.storageKey);
  const outDir = await mkdtemp(path.join(tmpdir(), "qantm-transcode-"));

  try {
    const probe = await probeVideo(inputAbs);

    if (!ffmpegPath) throw new Error("ffmpeg binary unavailable");
    await execFileP(ffmpegPath, buildTranscodeArgs(inputAbs, outDir, probe.fps), {
      timeout: TRANSCODE_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024,
    });

    const coverAbs = path.join(outDir, "cover.jpg");
    await execFileP(ffmpegPath, buildCoverArgs(inputAbs, coverAbs), {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Store renditions + cover + a small library thumb (sharp, from cover).
    const variants: Record<string, string> = {};
    for (const r of RENDITIONS) {
      const key = `${asset.storageKey}.${r.name}.mp4`;
      await putObject(key, await readFile(path.join(outDir, `${r.name}.mp4`)));
      variants[r.name] = key;
    }
    const coverBuf = await readFile(coverAbs);
    const coverKey = `${asset.storageKey}.cover.jpg`;
    await putObject(coverKey, coverBuf);
    const thumbKey = `${asset.storageKey}.thumb.jpg`;
    await putObject(thumbKey, await sharp(coverBuf).resize({ width: 480 }).jpeg({ quality: 85 }).toBuffer());
    variants.thumb = thumbKey;

    await db.asset.update({
      where: { id: asset.id },
      data: {
        status: "ready",
        width: probe.width,
        height: probe.height,
        durationS: probe.durationS,
        coverKey,
        variants: JSON.stringify(variants),
        error: null,
      },
    });
    await audit("asset.transcoded", {
      userId: asset.userId,
      metadata: { assetId: asset.id, durationS: Math.round(probe.durationS), renditions: RENDITIONS.length },
    });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db.asset.update({
      where: { id: asset.id },
      data: { status: "failed", error: message },
    });
    await audit("asset.transcode_failed", { userId: asset.userId, metadata: { assetId: asset.id } });
    console.error("transcode failed", asset.id, message);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
  return true;
}
