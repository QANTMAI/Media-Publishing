import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { listNotifications } from "@/lib/server/notifications";

/** GET /api/notifications — the operator's recent notifications + unread count.
 * Never contains secrets. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listNotifications(userId));
}
