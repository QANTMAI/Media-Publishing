/* Suggest (never auto-attach) a story image. Given a resolved article URL, we
 * fetch the page, read its og:image / twitter:image, fetch that image, and
 * return it as a data URL for a CSP-safe preview. The operator decides whether
 * to attach it (they own the rights call). Best-effort + fail safe: null on any
 * error. Every network hop uses the SSRF-safe fetch (operator-uncontrolled
 * hosts), with hard byte caps. */

import { safeFetch } from "./feeds";

const TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 6_000_000;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; QANTMPortal/1.0)" };

/** Extract an og:image / twitter:image URL from HTML, resolved against the page
 * URL (handles relative paths). Pure. */
export function extractOgImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url|:secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      try {
        return new URL(m[1].trim(), baseUrl).toString();
      } catch {
        // malformed candidate — try the next pattern
      }
    }
  }
  return null;
}

export interface SuggestedImage {
  dataUrl: string;
  contentType: string;
  sourceUrl: string;
}

export async function fetchSuggestedImage(articleUrl: string): Promise<SuggestedImage | null> {
  try {
    const page = await safeFetch(articleUrl, { headers: { ...UA, Accept: "text/html" }, timeoutMs: TIMEOUT_MS });
    if (!page.ok) return null;
    const htmlBuf = await page.arrayBuffer();
    if (htmlBuf.byteLength > MAX_HTML_BYTES) return null;
    const html = new TextDecoder("utf-8").decode(htmlBuf);
    const imgUrl = extractOgImage(html, articleUrl);
    if (!imgUrl) return null;

    const img = await safeFetch(imgUrl, { headers: UA, timeoutMs: TIMEOUT_MS });
    if (!img.ok) return null;
    const contentType = (img.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // Only formats the upload pipeline accepts — else we'd suggest an image the
    // operator can't actually attach (avif/svg/etc. would fail at upload).
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) return null;
    const bytes = await img.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

    const b64 = Buffer.from(bytes).toString("base64");
    return { dataUrl: `data:${contentType};base64,${b64}`, contentType, sourceUrl: imgUrl };
  } catch {
    return null; // fail safe
  }
}
