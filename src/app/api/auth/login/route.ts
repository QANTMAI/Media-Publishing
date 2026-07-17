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

  // Without a trusted proxy the IP is unknown and the bucket is shared —
  // a remote attacker hammering the operator's email must not lock the real
  // operator out, so the shared bucket gets a higher ceiling. (With
  // TRUST_PROXY=1 the per-IP key keeps the strict limit.)
  const rlKey = `login:${ip ?? "shared"}:${(email ?? "").toLowerCase()}`;
  if (rateLimited(rlKey, ip ? 5 : 20, 15 * 60_000)) {
    await audit("auth.login.throttled", { ip, metadata: { email: email ?? "" } });
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const user = email ? await db.user.findUnique({ where: { email: email.toLowerCase() } }) : null;
  // Constant-work comparison: unknown emails still burn a bcrypt verify, so
  // response timing doesn't reveal whether the account exists.
  // Real bcrypt-12 hash of a throwaway string (generated, verified ~250ms
  // compare on this hardware) — never matches any password.
  const DUMMY_HASH = "$2b$12$eO7phdZTml2pvLd/hYRqh.e0DEAcIntZCq4o3O9K1qazbd6VyTBRW";
  const ok = password
    ? await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH).then((r) => r && !!user)
    : false;

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
