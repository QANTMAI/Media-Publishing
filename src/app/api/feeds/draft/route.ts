import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { db } from "@/lib/server/db";
import { splitHeadline } from "@/lib/feed-draft";
import { resolveArticleUrl } from "@/lib/server/resolve-link";

/** POST /api/feeds/draft — plain (no-AI) draft from a trending item: a clean
 * headline + publisher AND a working link to the article. Resolves the Google
 * News redirect server-side to the real publisher URL; if that best-effort
 * resolution fails, it falls back to the raw feed link (which still opens in a
 * browser) so a working link is always included. No Anthropic call. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`feed-draft:${userId}`, 120, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const feedItemId = String(body.feedItemId ?? "").trim();
  if (!feedItemId) return NextResponse.json({ ok: false, reason: "no_item" });

  const item = await db.feedItem.findFirst({
    where: { id: feedItemId, source: { userId } },
    include: { source: { select: { title: true } } },
  });
  if (!item) return NextResponse.json({ ok: false, reason: "no_item" });

  const { headline, publisher } = splitHeadline(item.title, item.source.title);
  const lead = publisher ? `${headline} — ${publisher}` : headline;
  // Prefer the clean resolved publisher URL; fall back to the raw feed link so a
  // working link is always present.
  const link = (await resolveArticleUrl(item.link)) ?? item.link;
  const caption = link ? `${lead}\n\n${link}` : lead;

  return NextResponse.json({ ok: true, caption, link });
}
