import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** POST /api/targets/:id/cancel — remove the pending publish job so it never
 * fires; the target drops back to drafts (nothing is lost, per spec). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const target = await db.postTarget.findFirst({ where: { id, post: { userId } } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Atomic vs the worker: refuse while a claimed (in-flight) job exists, and
  // flip the state conditionally so a concurrent claim can't slip between
  // check and write (the whole block is one transaction).
  const outcome = await db.$transaction(async (tx) => {
    const inFlight = await tx.publishJob.count({
      where: { postTargetId: id, completedAt: null, claimedAt: { not: null } },
    });
    if (inFlight > 0) return "in-flight";
    const updated = await tx.postTarget.updateMany({
      where: { id, state: { in: ["draft", "scheduled", "failed"] } },
      data: { state: "draft", error: null },
    });
    if (updated.count === 0) return "locked";
    await tx.publishJob.deleteMany({ where: { postTargetId: id, completedAt: null } });
    return "ok";
  });

  if (outcome !== "ok") {
    return NextResponse.json(
      { error: "Post is publishing right now — locked to avoid a double-post" },
      { status: 409 },
    );
  }

  await audit("post.cancel", { userId, ip: requestIp(req), metadata: { targetId: id } });
  return NextResponse.json({ ok: true });
}
