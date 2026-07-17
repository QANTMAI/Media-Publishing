import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";

/** GET /api/metrics — latest REAL platform metrics per published target.
 * Only rows that came back from actual platform insights APIs exist here;
 * mock publishes have no snapshots by design (no fabricated numbers, ever).
 * Empty response ⇒ the UI says so instead of inventing data. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const snapshots = await db.metricSnapshot.findMany({
    where: { target: { post: { userId } } },
    orderBy: { fetchedAt: "desc" },
    take: 1000,
    include: {
      target: {
        select: {
          id: true,
          permalink: true,
          scheduledAt: true,
          post: { select: { baseCaption: true } },
          account: { select: { name: true, mark: true, handle: true } },
        },
      },
    },
  });

  // Latest snapshot per target (list is fetchedAt-desc, so first wins).
  const latestByTarget = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestByTarget.has(s.postTargetId)) latestByTarget.set(s.postTargetId, s);
  }

  const posts = [...latestByTarget.values()].map((s) => ({
    targetId: s.target.id,
    caption: s.target.post.baseCaption,
    account: s.target.account,
    permalink: s.target.permalink,
    scheduledAt: s.target.scheduledAt?.toISOString() ?? null,
    fetchedAt: s.fetchedAt.toISOString(),
    views: s.views,
    reach: s.reach,
    likes: s.likes,
    comments: s.comments,
    shares: s.shares,
    saves: s.saves,
  }));

  const sum = (k: "views" | "reach" | "likes" | "comments" | "shares" | "saves") =>
    posts.reduce((acc, p) => acc + (p[k] ?? 0), 0);

  return NextResponse.json({
    posts: posts.sort((a, b) => (b.views ?? b.reach ?? 0) - (a.views ?? a.reach ?? 0)),
    totals:
      posts.length > 0
        ? { views: sum("views"), reach: sum("reach"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), saves: sum("saves") }
        : null,
  });
}
