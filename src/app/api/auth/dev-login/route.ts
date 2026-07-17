import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/server/db";
import { devAuthBypass, setSessionCookie } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { rateLimited } from "@/lib/server/rate-limit";

/** POST /api/auth/dev-login — password-only sign-in that SKIPS 2FA.
 * Only exists when devAuthBypass() is true (non-production + explicit
 * AUTH_DEV_BYPASS=1); returns 404 otherwise so it's invisible in prod.
 * Isolated from the real login/verify flow, which is unchanged. */
export async function POST(req: Request) {
  if (!devAuthBypass()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = requestIp(req);
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (rateLimited(`dev-login:${ip ?? "shared"}:${(email ?? "").toLowerCase()}`, 20, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429 });
  }

  const user = email ? await db.user.findUnique({ where: { email: email.toLowerCase() } }) : null;
  const DUMMY_HASH = "$2b$12$eO7phdZTml2pvLd/hYRqh.e0DEAcIntZCq4o3O9K1qazbd6VyTBRW";
  const ok = password
    ? await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH).then((r) => r && !!user)
    : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
  }

  await setSessionCookie(user.id);
  await audit("auth.dev_login", { userId: user.id, ip });
  return NextResponse.json({ ok: true });
}
