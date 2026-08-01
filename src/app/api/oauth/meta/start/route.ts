import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { readSession } from "@/lib/server/session";
import { metaAuthUrl } from "@/lib/server/meta";
import { resolveOAuth, oauthRedirectUri } from "@/lib/server/oauth-config";

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

  // Real OAuth only — configured via env or the in-app vault. An unconfigured
  // platform refuses honestly; there is no mock/simulated connect path.
  const creds = await resolveOAuth(userId, "meta");
  if (creds) {
    const redirectUri = oauthRedirectUri(new URL(req.url).origin, "meta");
    return NextResponse.redirect(metaAuthUrl(state, { clientId: creds.clientId, redirectUri }));
  }
  return NextResponse.redirect(new URL("/accounts?connect_error=not_configured", req.url));
}
