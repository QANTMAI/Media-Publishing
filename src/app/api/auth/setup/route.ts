import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db } from "@/lib/server/db";
import { audit, requestIp } from "@/lib/server/audit";
import { setSessionCookie } from "@/lib/server/session";
import { seedDemoAccounts } from "@/lib/server/seed-accounts";
import { seedMemory } from "@/lib/server/seed-memory";

/** POST /api/auth/setup — first-run: create the single operator account.
 * Two-factor is optional: pass enable2fa:true to begin TOTP enrollment (a QR
 * to confirm at /setup/confirm); otherwise the account is finalized right away
 * (demo accounts + memory seeded, session issued). Refuses once a user exists. */
export async function POST(req: Request) {
  if ((await db.user.count()) > 0) {
    return NextResponse.json({ error: "Already set up" }, { status: 409 });
  }

  const { email, password, enable2fa } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    enable2fa?: boolean;
  };
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!password || password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (enable2fa) {
    const totpSecret = authenticator.generateSecret();
    const user = await db.user.create({
      data: { email: email.toLowerCase(), passwordHash, totpSecret, totpEnabled: false },
    });
    const otpauth = authenticator.keyuri(user.email, "QANTM Media Portal", totpSecret);
    const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
    await audit("auth.setup", { userId: user.id, ip: requestIp(req), metadata: { twofa: true } });
    // The secret is shown once, during enrollment, so the operator can add it
    // to their authenticator manually if they can't scan the QR. The account
    // is finalized at /setup/confirm once a live code proves it works.
    return NextResponse.json({ needs2fa: true, qrDataUrl, manualKey: totpSecret });
  }

  // Password-only operator: finalize immediately.
  const user = await db.user.create({
    data: { email: email.toLowerCase(), passwordHash, totpEnabled: false },
  });
  await seedDemoAccounts(user.id);
  await seedMemory(user.id).catch((err) => console.error("memory seed failed", err));
  await setSessionCookie(user.id);
  await audit("auth.setup", { userId: user.id, ip: requestIp(req), metadata: { twofa: false } });
  return NextResponse.json({ ok: true, finalized: true });
}
