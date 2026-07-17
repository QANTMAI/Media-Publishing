/* Media validation + image variant generation (Build Plan §03.1).
 *
 * Server-side validation is the enforcement point (the composer's client
 * checks are advisory). Image variants cover the aspect ratios the platforms
 * want (1:1, 4:5, 16:9) plus a library thumbnail. Video transcoding needs
 * ffmpeg and lands with the video tooling ticket (T-302) — originals are
 * stored and published as-is until then. */

import sharp from "sharp";
import { newStorageKey, putObject } from "./storage";

export const IMAGE_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const VIDEO_MIMES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // generous over per-platform caps
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // X's cap, the largest we accept

export function validateUpload(kind: "image" | "video", mime: string, size: number): string | null {
  const table = kind === "image" ? IMAGE_MIMES : VIDEO_MIMES;
  if (!table[mime]) {
    return `Unsupported ${kind} type ${mime} — accepted: ${Object.keys(table).join(", ")}`;
  }
  const cap = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size <= 0 || size > cap) {
    return `File must be between 1 byte and ${Math.round(cap / 1024 / 1024)}MB`;
  }
  return null;
}

export function extForMime(mime: string): string {
  return IMAGE_MIMES[mime] ?? VIDEO_MIMES[mime] ?? "bin";
}

export interface VariantSet {
  thumb?: string;
  square?: string;
  portrait?: string;
  landscape?: string;
}

const VARIANT_SPECS: Array<{ name: keyof VariantSet; width: number; height: number | null }> = [
  { name: "thumb", width: 480, height: null }, // library grid; keeps aspect
  { name: "square", width: 1080, height: 1080 }, // 1:1 feed
  { name: "portrait", width: 1080, height: 1350 }, // 4:5 IG portrait
  { name: "landscape", width: 1920, height: 1080 }, // 16:9
];

export interface ProcessedImage {
  width: number;
  height: number;
  variants: VariantSet;
}

/** Probe dimensions and generate platform-fit variants from an original.
 * Variant keys derive from the original's key: `<key>.<variant>.jpg`. */
export async function processImage(originalKey: string, data: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Could not read image dimensions — corrupt file?");

  const variants: VariantSet = {};
  for (const spec of VARIANT_SPECS) {
    const pipeline = sharp(data).rotate(); // honor EXIF orientation
    const resized = spec.height
      ? pipeline.resize(spec.width, spec.height, { fit: "cover", position: "attention" })
      : pipeline.resize({ width: spec.width, withoutEnlargement: true });
    const buf = await resized.jpeg({ quality: 85 }).toBuffer();
    const variantKey = `${originalKey}.${spec.name}.jpg`;
    await putObject(variantKey, buf);
    variants[spec.name] = variantKey;
  }
  return { width, height, variants };
}

export function variantKeys(variantsJson: string | null): string[] {
  if (!variantsJson) return [];
  try {
    return Object.values(JSON.parse(variantsJson) as VariantSet).filter(Boolean) as string[];
  } catch {
    return [];
  }
}

export { newStorageKey };
