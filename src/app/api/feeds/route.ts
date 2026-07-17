import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { FeedError, addSource, listItems, listSources } from "@/lib/server/feeds";

/** GET /api/feeds — the operator's RSS sources + recent items across them. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [sources, items] = await Promise.all([listSources(userId), listItems(userId)]);
  return NextResponse.json({ sources, items });
}

/** POST /api/feeds — add an RSS/Atom source. Validated by a live fetch, so a
 * dead or non-feed URL is rejected up front with a real reason. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url?.trim()) return NextResponse.json({ error: "Feed URL is required" }, { status: 400 });

  // One extra guard beyond the client: cap how many feeds an operator can add.
  if ((await db.feedSource.count({ where: { userId } })) >= 25) {
    return NextResponse.json({ error: "Feed limit reached (25)" }, { status: 409 });
  }

  try {
    const source = await addSource(userId, url);
    await audit("feed.add", { userId, ip: requestIp(req), metadata: { url: source.url } });
    return NextResponse.json({ source }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedError) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Could not add that feed" }, { status: 500 });
  }
}
