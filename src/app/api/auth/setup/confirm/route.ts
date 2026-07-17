import { NextResponse } from "next/server";
import { authenticator } from "otplib";

// Accept the adjacent 30s step to tolerate device clock skew.
authenticator.options = { window: 1 };
import { db } from "@/lib/server/db";
import { audit, requestIp } from "@/lib/server/audit";
import { seedDemoAccounts } from "@/lib/server/seed-accounts";

/** POST /api/auth/setup/confirm — prove the authenticator works before
 * enabling the account. */
export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const user = await db.user.findFirst({ where: { totpEnabled: false } });
  if (!user?.totpSecret) {
    return NextResponse.json({ error: "Nothing to confirm" }, { status: 409 });
  }
  if (!code || !authenticator.verify({ token: code.replace(/\s/g, ""), secret: user.totpSecret })) {
    return NextResponse.json({ error: "Code didn't match — try the current code" }, { status: 401 });
  }
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await seedDemoAccounts(user.id);
  await audit("auth.setup.confirmed", { userId: user.id, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
