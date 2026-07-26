import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { MemoryError, createMemory, listMemory, memoryLaneCounts, searchMemory } from "@/lib/server/memory";

/** GET /api/memory — list active memory (optionally by ?lane=), or full-text
 * recall with ?q=. Always returns per-lane counts for the overview. */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const lane = url.searchParams.get("lane") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  const items = q ? await searchMemory(q, { lane }) : await listMemory({ lane, status });
  return NextResponse.json({ items, counts: await memoryLaneCounts(), query: q ?? null });
}

/** POST /api/memory — author a memory item (+ evidence links). */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const item = await createMemory(userId, body);
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof MemoryError) return NextResponse.json({ error: err.message }, { status: 422 });
    return NextResponse.json({ error: "Could not save memory" }, { status: 500 });
  }
}
