import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

/** GET /api/auth/status — does the portal have its operator account yet?
 * The account exists once it's created; two-factor is an optional second
 * factor layered on top, so an operator without 2FA still counts as set up. */
export async function GET() {
  const users = await db.user.count();
  return NextResponse.json({ needsSetup: users === 0 });
}
