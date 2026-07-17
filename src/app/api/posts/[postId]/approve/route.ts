import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { PLATFORM_RULES } from "@/lib/platforms";

/** POST /api/posts/:postId/approve — approve a reviewed draft: move its draft
 * targets to "scheduled" and queue a real PublishJob for each, so the worker
 * publishes them like any other scheduled post. This is the review inbox's
 * Approve action. Keeps each target's planned time when it's in the future;
 * a planned time that has passed is bumped to the next slot (now + 15 min).
 * Same enforcement as manual scheduling: account must be connected and the
 * caption must fit the platform. */
export async function POST(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = await ctx.params;
  const post = await db.post.findFirst({
    where: { id: postId, userId },
    include: { targets: { include: { account: true } } },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const draftTargets = post.targets.filter((t) => t.state === "draft");
  if (draftTargets.length === 0) {
    return NextResponse.json({ error: "No draft targets to approve" }, { status: 409 });
  }

  // Enforce the same gates as manual scheduling before anything is queued.
  for (const t of draftTargets) {
    if (t.account.status === "disconnected") {
      return NextResponse.json({ error: `Not connected: ${t.account.handle}` }, { status: 409 });
    }
    const rules = PLATFORM_RULES[t.account.platform];
    if (!rules) {
      return NextResponse.json(
        { error: `${t.account.name} publishing is not integrated yet — can't approve` },
        { status: 422 },
      );
    }
    const caption = t.captionOverride?.trim() || post.baseCaption;
    if (caption.length > rules.limit) {
      return NextResponse.json(
        { error: `Caption is ${caption.length - rules.limit} over the ${rules.name} limit` },
        { status: 422 },
      );
    }
  }

  const floor = Date.now() + 15 * 60_000;
  const scheduled = draftTargets.map((t) => {
    const planned = t.scheduledAt?.getTime() ?? 0;
    const runAt = new Date(planned > floor ? planned : floor);
    return { id: t.id, runAt };
  });

  // One transaction: each target flips to scheduled and gets its job, and the
  // post's own status follows — no window where a target is scheduled with no
  // job, or a job exists for a still-draft target.
  await db.$transaction([
    ...scheduled.map((s) =>
      db.postTarget.update({ where: { id: s.id }, data: { state: "scheduled", scheduledAt: s.runAt } }),
    ),
    ...scheduled.map((s) => db.publishJob.create({ data: { postTargetId: s.id, runAt: s.runAt } })),
    db.post.update({ where: { id: postId }, data: { status: "scheduled" } }),
  ]);

  await audit("post.approve", { userId, ip: requestIp(req), metadata: { postId, targets: scheduled.length } });
  return NextResponse.json({ ok: true, scheduled: scheduled.length });
}
