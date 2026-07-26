import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { readSession } from "@/lib/server/session";
import { youtubeAuthUrl, youtubeConfigured } from "@/lib/server/youtube";

/** GET /api/oauth/youtube/start — kick off the Google/YouTube OAuth grant.
 * Same CSRF pattern as Meta/LinkedIn: a state nonce is double-submitted
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

  // Same policy as the other platforms: mock when OAUTH_MOCK=1 OR the app isn't
  // configured yet — the grant is simulated and the row honestly labeled mock.
  if (process.env.OAUTH_MOCK === "1" || !youtubeConfigured()) {
    return NextResponse.redirect(new URL(`/api/oauth/youtube/callback?mock=1&state=${state}`, req.url));
  }
  return NextResponse.redirect(youtubeAuthUrl(state));
}
