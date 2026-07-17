import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { markRead } from "@/lib/server/notifications";

/** POST /api/notifications/read — mark one notification ({id}) or all
 * ({all:true}) read. Returns how many changed. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, all } = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };
  if (!id && !all) return NextResponse.json({ error: "id or all required" }, { status: 400 });

  const count = await markRead(userId, { id, all });
  return NextResponse.json({ ok: true, count });
}
