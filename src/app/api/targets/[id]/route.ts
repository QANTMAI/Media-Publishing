import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** PATCH /api/targets/:id — reschedule (calendar drag). Moves the target and
 * its pending job together. Published/mid-publish targets are locked. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { scheduledAt } = (await req.json().catch(() => ({}))) as { scheduledAt?: string };
  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "scheduledAt (ISO) required" }, { status: 400 });
  }

  const target = await db.postTarget.findFirst({ where: { id, post: { userId } } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic vs the worker: never move a target whose job is claimed (a publish
  // may be in flight — moving it would double-post).
  const outcome = await db.$transaction(async (tx) => {
    const inFlight = await tx.publishJob.count({
      where: { postTargetId: id, completedAt: null, claimedAt: { not: null } },
    });
    if (inFlight > 0) return "in-flight";
    const updated = await tx.postTarget.updateMany({
      where: { id, state: { in: ["draft", "scheduled", "failed"] } },
      data: { scheduledAt: when, state: "scheduled", error: null },
    });
    if (updated.count === 0) return "locked";
    // Replace the pending job; recreate it if the target had dropped to draft.
    await tx.publishJob.deleteMany({ where: { postTargetId: id, completedAt: null } });
    await tx.publishJob.create({ data: { postTargetId: id, runAt: when } });
    return "ok";
  });

  if (outcome !== "ok") {
    return NextResponse.json({ error: "Post already published or mid-publish — locked" }, { status: 409 });
  }

  await audit("post.reschedule", {
    userId,
    ip: requestIp(req),
    metadata: { targetId: id, scheduledAt: when.toISOString() },
  });
  return NextResponse.json({ ok: true, scheduledAt: when.toISOString() });
}
