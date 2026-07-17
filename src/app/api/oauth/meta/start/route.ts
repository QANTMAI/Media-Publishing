import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { readSession } from "@/lib/server/session";
import { metaAuthUrl, mockMode } from "@/lib/server/meta";

/** GET /api/oauth/meta/start — kick off the Meta OAuth grant. The state nonce
 * is double-submitted (cookie + query) to block CSRF on the callback. */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));

  const state = randomBytes(16).toString("hex");
  (await cookies()).set("qantm_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  if (mockMode()) {
    // No Meta app configured yet (app review pending) — simulate the grant so
    // the connect → vault → accounts pipeline stays testable end to end.
    return NextResponse.redirect(new URL(`/api/oauth/meta/callback?mock=1&state=${state}`, req.url));
  }
  return NextResponse.redirect(metaAuthUrl(state));
}
