import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** PATCH /api/feeds/:id — enable/disable a source (disabled sources are kept
 * but excluded from the trending feed and the poller). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { enabled } = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });

  const res = await db.feedSource.updateMany({ where: { id, userId }, data: { enabled } });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit("feed.toggle", { userId, ip: requestIp(req), metadata: { id, enabled } });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/feeds/:id — remove a source (cascade removes its items). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await db.feedSource.deleteMany({ where: { id, userId } });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await audit("feed.delete", { userId, ip: requestIp(req), metadata: { id } });
  return NextResponse.json({ ok: true });
}
