import { NextResponse } from "next/server";
import { bumpSessionEpoch, clearSession, readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";

/** POST /api/auth/logout — clears the cookie AND bumps the session epoch,
 * revoking every outstanding session token (a stolen cookie dies too). */
export async function POST(req: Request) {
  const userId = await readSession();
  await clearSession();
  if (userId) {
    await bumpSessionEpoch();
    await audit("auth.logout", { userId, ip: requestIp(req) });
  }
  return NextResponse.json({ ok: true });
}
