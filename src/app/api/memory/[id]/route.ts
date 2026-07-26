import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { MemoryError, archiveMemory, getMemory, updateMemory } from "@/lib/server/memory";

/** GET /api/memory/:id — one item with its cited evidence. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const item = await getMemory((await ctx.params).id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

/** PATCH /api/memory/:id — edit title/body/status/confidence/tags. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const patch = await req.json().catch(() => ({}));
  try {
    const item = await updateMemory(userId, (await ctx.params).id, patch);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof MemoryError) {
      return NextResponse.json({ error: err.message }, { status: err.message === "Not found" ? 404 : 422 });
    }
    return NextResponse.json({ error: "Could not update memory" }, { status: 500 });
  }
}

/** DELETE /api/memory/:id — archive (never hard-deleted; the trail stays). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await archiveMemory(userId, (await ctx.params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MemoryError) return NextResponse.json({ error: err.message }, { status: 404 });
    return NextResponse.json({ error: "Could not archive" }, { status: 500 });
  }
}
