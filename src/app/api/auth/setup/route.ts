import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { db } from "@/lib/server/db";
import { audit, requestIp } from "@/lib/server/audit";

/** POST /api/auth/setup — first-run: create the single operator account and
 * begin mandatory TOTP enrollment. Refuses once a user exists. */
export async function POST(req: Request) {
  const confirmed = await db.user.count({ where: { totpEnabled: true } });
  if (confirmed > 0) {
    return NextResponse.json({ error: "Already set up" }, { status: 409 });
  }
  // A half-enrolled operator (created but 2FA never confirmed) is replaced so
  // setup can be restarted cleanly.
  await db.user.deleteMany({ where: { totpEnabled: false } });

  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (!password || password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
  }

  const totpSecret = authenticator.generateSecret();
  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      totpSecret,
      totpEnabled: false,
    },
  });

  const otpauth = authenticator.keyuri(user.email, "QANTM Media Portal", totpSecret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 });

  await audit("auth.setup", { userId: user.id, ip: requestIp(req) });
  // The secret is shown once, during enrollment, so the operator can add it
  // to their authenticator manually if they can't scan the QR.
  return NextResponse.json({ qrDataUrl, manualKey: totpSecret });
}
