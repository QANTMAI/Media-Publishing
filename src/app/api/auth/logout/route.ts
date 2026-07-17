import { NextResponse } from "next/server";
import { clearSession, readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** POST /api/auth/logout */
export async function POST(req: Request) {
  const userId = await readSession();
  await clearSession();
  if (userId) await audit("auth.logout", { userId, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
