import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** PATCH /api/posts/:postId — edit a post's category and/or base caption.
 * Category is Post-level, so this affects all of the post's targets; the
 * caption edit updates the base caption (per-platform overrides are separate).
 * Used by the calendar dialog and the dashboard review inbox. */
export async function PATCH(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = await ctx.params;
  const { category, baseCaption } = (await req.json().catch(() => ({}))) as {
    category?: string;
    baseCaption?: string;
  };

  const data: { category?: string; baseCaption?: string } = {};
  if (category !== undefined) {
    if (!category.trim()) return NextResponse.json({ error: "category required" }, { status: 400 });
    data.category = category.trim().slice(0, 60);
  }
  if (baseCaption !== undefined) {
    if (!baseCaption.trim()) return NextResponse.json({ error: "caption cannot be empty" }, { status: 400 });
    data.baseCaption = baseCaption.trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await db.post.updateMany({ where: { id: postId, userId }, data });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await audit("post.edit", { userId, ip: requestIp(req), metadata: { postId, fields: Object.keys(data) } });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/posts/:postId — discard a DRAFT post entirely (used by the
 * review inbox's Discard). Refuses to delete anything already scheduled or
 * published: those go through the cancel flow, which preserves history and
 * media. Cascade removes the draft's targets. */
export async function DELETE(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { postId } = await ctx.params;
  const post = await db.post.findFirst({
    where: { id: postId, userId },
    include: { targets: { select: { state: true } } },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only pure drafts are discardable — if any target has moved beyond draft,
  // refuse and point at the cancel flow.
  const nonDraft = post.targets.some((t) => t.state !== "draft");
  if (post.status !== "draft" || nonDraft) {
    return NextResponse.json({ error: "Only drafts can be discarded — cancel scheduled posts instead" }, { status: 409 });
  }

  await db.post.delete({ where: { id: postId } });
  await audit("post.discard", { userId, ip: requestIp(req), metadata: { postId } });
  return NextResponse.json({ ok: true });
}
