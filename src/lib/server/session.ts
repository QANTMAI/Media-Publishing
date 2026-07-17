/* Short-lived sessions (Build Plan §06): jose-signed JWT in an httpOnly
 * cookie. Two tiers: a 5-minute "preauth" cookie between password and TOTP
 * verification, and a 12-hour full session after 2FA. */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SESSION_COOKIE = "qantm_session";
const PREAUTH_COOKIE = "qantm_preauth";
const SESSION_TTL_S = 60 * 60 * 12; // 12h
const PREAUTH_TTL_S = 60 * 5; // 5min

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(s);
}

async function sign(payload: Record<string, unknown>, ttlSeconds: number) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

async function verifyToken<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function setPreauthCookie(userId: string) {
  (await cookies()).set(PREAUTH_COOKIE, await sign({ sub: userId, stage: "preauth" }, PREAUTH_TTL_S), {
    ...cookieOpts,
    maxAge: PREAUTH_TTL_S,
  });
}

export async function readPreauth(): Promise<string | null> {
  const jar = await cookies();
  const payload = await verifyToken<{ sub: string; stage: string }>(jar.get(PREAUTH_COOKIE)?.value);
  return payload?.stage === "preauth" ? payload.sub : null;
}

export async function setSessionCookie(userId: string) {
  const jar = await cookies();
  jar.delete(PREAUTH_COOKIE);
  jar.set(SESSION_COOKIE, await sign({ sub: userId, stage: "full" }, SESSION_TTL_S), {
    ...cookieOpts,
    maxAge: SESSION_TTL_S,
  });
}

/** Returns the authenticated user id, or null. */
export async function readSession(): Promise<string | null> {
  const jar = await cookies();
  const payload = await verifyToken<{ sub: string; stage: string }>(jar.get(SESSION_COOKIE)?.value);
  return payload?.stage === "full" ? payload.sub : null;
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(PREAUTH_COOKIE);
}
