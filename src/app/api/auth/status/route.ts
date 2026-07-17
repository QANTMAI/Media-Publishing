import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

/** GET /api/auth/status — does the portal have its operator account yet?
 * Setup only counts once 2FA enrollment is confirmed; until then the flow
 * stays resumable. */
export async function GET() {
  const users = await db.user.count({ where: { totpEnabled: true } });
  return NextResponse.json({ needsSetup: users === 0 });
}
