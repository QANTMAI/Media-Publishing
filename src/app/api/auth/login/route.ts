import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/server/db";
import { setPreauthCookie } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { rateLimited, rateLimitReset } from "@/lib/server/rate-limit";

/** POST /api/auth/login — password check. On success issues a 5-minute
 * preauth cookie; the session only exists after TOTP verification.
 * Rate limited: 5 attempts / 15 min per IP+email. */
export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  const ip = requestIp(req);

  const rlKey = `login:${ip ?? "local"}:${(email ?? "").toLowerCase()}`;
  if (rateLimited(rlKey, 5, 15 * 60_000)) {
    await audit("auth.login.throttled", { ip, metadata: { email: email ?? "" } });
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const user = email ? await db.user.findUnique({ where: { email: email.toLowerCase() } }) : null;
  const ok = user && password ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !ok) {
    await audit("auth.login.failed", { ip, metadata: { email: email ?? "" } });
    // Uniform error whether the email or the password was wrong.
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }
  if (!user.totpEnabled) {
    return NextResponse.json({ error: "2FA enrollment incomplete — finish setup first" }, { status: 409 });
  }

  rateLimitReset(rlKey);
  await setPreauthCookie(user.id);
  await audit("auth.login", { userId: user.id, ip });
  return NextResponse.json({ ok: true, next: "2fa" });
}
