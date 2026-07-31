import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

/** GET /api/auth/status — does the portal have a FINALIZED operator account?
 * "Finalized" = either 2FA-confirmed (totpEnabled) or password-only (no secret
 * stored). A user mid-2FA-enrollment (a secret set but never confirmed) does
 * NOT count — otherwise an abandoned enrollment would lock setup while leaving
 * 2FA unenforced. Setup stays reachable to finish or restart it. */
export async function GET() {
  const finalized = await db.user.count({
    where: { OR: [{ totpEnabled: true }, { totpEnabled: false, totpSecret: null }] },
  });
  return NextResponse.json({ needsSetup: finalized === 0 });
}
