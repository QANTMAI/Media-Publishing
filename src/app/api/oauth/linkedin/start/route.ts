import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { readSession } from "@/lib/server/session";
import { linkedinAuthUrl } from "@/lib/server/linkedin";
import { resolveOAuth, oauthRedirectUri } from "@/lib/server/oauth-config";

/** GET /api/oauth/linkedin/start — kick off the LinkedIn OAuth grant.
 * Same CSRF pattern as Meta: the state nonce is double-submitted
 * (httpOnly cookie + query) and verified on the callback. */
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

  // Real OAuth when configured; mock ONLY under the explicit OAUTH_MOCK=1 dev
  // flag. In live mode an unconfigured platform refuses honestly (no fake row).
  const creds = await resolveOAuth(userId, "linkedin");
  if (creds) {
    const redirectUri = oauthRedirectUri(new URL(req.url).origin, "linkedin");
    return NextResponse.redirect(linkedinAuthUrl(state, { clientId: creds.clientId, redirectUri }));
  }
  return NextResponse.redirect(new URL("/accounts?connect_error=not_configured", req.url));
}
