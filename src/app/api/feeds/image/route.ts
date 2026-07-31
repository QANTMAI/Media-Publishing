import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { db } from "@/lib/server/db";
import { resolveArticleUrl } from "@/lib/server/resolve-link";
import { fetchSuggestedImage } from "@/lib/server/og-image";

const IMAGE_MAX_PER_HOUR = 60;

/** POST /api/feeds/image — SUGGEST (never attach) the story's og:image for a
 * stored feed item. Returns a data URL for preview; the operator decides
 * whether to attach it (they own the rights call). Honest no-op reasons. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`feed-image:${userId}`, IMAGE_MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const feedItemId = String(body.feedItemId ?? "").trim();
  if (!feedItemId) return NextResponse.json({ ok: false, reason: "no_item" });

  // Ownership-checked lookup — the link comes from our DB, not the client.
  const item = await db.feedItem.findFirst({ where: { id: feedItemId, source: { userId } }, select: { link: true } });
  if (!item) return NextResponse.json({ ok: false, reason: "no_item" });

  const articleUrl = await resolveArticleUrl(item.link);
  if (!articleUrl) return NextResponse.json({ ok: false, reason: "no_link" });

  const image = await fetchSuggestedImage(articleUrl);
  if (!image) return NextResponse.json({ ok: false, reason: "no_image" });

  let publisher = "";
  try {
    publisher = new URL(image.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    // leave blank
  }
  return NextResponse.json({ ok: true, dataUrl: image.dataUrl, sourceUrl: image.sourceUrl, publisher });
}
