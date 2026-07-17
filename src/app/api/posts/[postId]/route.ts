import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** PATCH /api/posts/:postId — reassign a post's category (recolors it on the
 * calendar). Category is Post-level, so this affects all of the post's
 * targets at once. */
export async function PATCH(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = await ctx.params;
  const { category } = (await req.json().catch(() => ({}))) as { category?: string };
  if (!category?.trim()) {
    return NextResponse.json({ error: "category required" }, { status: 400 });
  }

  const result = await db.post.updateMany({
    where: { id: postId, userId },
    data: { category: category.trim().slice(0, 60) },
  });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await audit("post.recategorize", { userId, ip: requestIp(req), metadata: { postId, category } });
  return NextResponse.json({ ok: true });
}
