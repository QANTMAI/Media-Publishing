import { NextResponse } from "next/server";
import { authenticator } from "otplib";
import { db } from "@/lib/server/db";
import { clearSession, readPreauth, setSessionCookie } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { rateLimited, rateLimitReset } from "@/lib/server/rate-limit";

// Accept the adjacent 30s step to tolerate device clock skew.
authenticator.options = { window: 1 };
const TOTP_STEP_MS = 30_000;

/** POST /api/auth/verify — TOTP step. Requires a live preauth cookie.
 * Hardened: 5 code attempts per preauth (then the preauth is revoked), and
 * each accepted code's time-step is persisted so a code can never be
 * replayed, even inside its validity window. */
export async function POST(req: Request) {
  const userId = await readPreauth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in again — verification window expired" }, { status: 401 });
  }

  const rlKey = `verify:${userId}`;
  if (rateLimited(rlKey, 5, 5 * 60_000)) {
    await clearSession(); // burn the preauth — attacker must redo the password step
    await audit("auth.verify.throttled", { userId, ip: requestIp(req) });
    return NextResponse.json({ error: "Too many codes — sign in again" }, { status: 429 });
  }

  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecret || !user.totpEnabled) {
    return NextResponse.json({ error: "2FA not enrolled" }, { status: 409 });
  }

  const token = (code ?? "").replace(/\s/g, "");
  // checkDelta returns which step (relative to now) the code belongs to, or
  // null when it doesn't verify — this is what makes exact replay detection
  // possible with a ±1-step acceptance window.
  const delta = token ? authenticator.checkDelta(token, user.totpSecret) : null;
  if (delta === null) {
    await audit("auth.verify.failed", { userId, ip: requestIp(req) });
    return NextResponse.json({ error: "Code didn't match — try the current code" }, { status: 401 });
  }

  // Replay guard: accepted steps are strictly monotonic, so the same code
  // can never be accepted twice, even inside its validity window.
  const matchedStep = BigInt(Math.floor(Date.now() / TOTP_STEP_MS) + delta);
  const claimed = await db.user.updateMany({
    where: {
      id: userId,
      OR: [{ totpLastStep: null }, { totpLastStep: { lt: matchedStep } }],
    },
    data: { totpLastStep: matchedStep },
  });
  if (claimed.count === 0) {
    await audit("auth.verify.replayed", { userId, ip: requestIp(req) });
    return NextResponse.json({ error: "That code was already used — wait for the next one" }, { status: 401 });
  }

  rateLimitReset(rlKey);
  await setSessionCookie(user.id);
  await audit("auth.verify", { userId, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
