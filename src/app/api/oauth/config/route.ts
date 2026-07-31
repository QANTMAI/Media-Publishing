import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { audit, requestIp } from "@/lib/server/audit";
import {
  isOAuthPlatform,
  setStoredOAuth,
  deleteStoredOAuth,
  oauthConfiguredFor,
  oauthRedirectUri,
  OAUTH_GUIDE,
} from "@/lib/server/oauth-config";

/** GET /api/oauth/config?platform=… — the setup guide + the exact redirect URI
 * to register + whether creds are stored. (Never returns the stored secret.) */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const platform = new URL(req.url).searchParams.get("platform") ?? "";
  if (!isOAuthPlatform(platform)) return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  return NextResponse.json({
    platform,
    guide: OAUTH_GUIDE[platform],
    redirectUri: oauthRedirectUri(new URL(req.url).origin, platform),
    configured: await oauthConfiguredFor(userId, platform),
  });
}

/** POST — store this platform's OAuth app Client ID + Secret (encrypted vault). */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`oauth-config:${userId}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts — try again shortly" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const platform = String(body.platform ?? "");
  if (!isOAuthPlatform(platform)) return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  const clientId = String(body.clientId ?? "").trim();
  const clientSecret = String(body.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Client ID and Client Secret are both required" }, { status: 422 });
  }
  await setStoredOAuth(userId, platform, { clientId, clientSecret });
  await audit("account.oauth_config", { userId, ip: requestIp(req), metadata: { platform } });
  return NextResponse.json({ ok: true });
}

/** DELETE — forget this platform's stored OAuth app credentials. */
export async function DELETE(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const platform = new URL(req.url).searchParams.get("platform") ?? "";
  if (!isOAuthPlatform(platform)) return NextResponse.json({ error: "unknown platform" }, { status: 400 });
  await deleteStoredOAuth(userId, platform);
  await audit("account.oauth_config", { userId, ip: requestIp(req), metadata: { platform, removed: true } });
  return NextResponse.json({ ok: true });
}
