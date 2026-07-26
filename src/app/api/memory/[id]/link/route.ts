import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { MemoryError, addMemoryLink } from "@/lib/server/memory";

/** POST /api/memory/:id/link — cite an evidence source on a memory item
 * ({kind, ref, note}). Provenance for beliefs/distillates. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    await addMemoryLink(userId, (await ctx.params).id, body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof MemoryError) {
      return NextResponse.json({ error: err.message }, { status: err.message === "Not found" ? 404 : 422 });
    }
    return NextResponse.json({ error: "Could not add link" }, { status: 500 });
  }
}
