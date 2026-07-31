import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteSecret, storeSecret } from "@/lib/server/vault";
import { audit, requestIp } from "@/lib/server/audit";
import { YOUTUBE_SCOPES, youtubeChannel, youtubeExchangeCode } from "@/lib/server/youtube";
import { resolveOAuth, oauthRedirectUri } from "@/lib/server/oauth-config";

/** GET /api/oauth/youtube/callback — finish the grant: verify state, exchange
 * the code, resolve the channel identity, store the REFRESH token in the vault
 * (the durable credential — access tokens live ~1h and are minted per publish),
 * upsert the SocialAccount row, land on /accounts.
 *
 * Facts encoded: Google returns a refresh_token only with access_type=offline;
 * prompt=consent makes it reliable. We treat a missing refresh_token as a hard
 * error — without it the account would stop working after ~1 hour. */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const jar = await cookies();
  const expectedState = jar.get("qantm_oauth_state")?.value;
  jar.delete("qantm_oauth_state");

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/accounts?connect_error=${encodeURIComponent(reason)}`, req.url));

  if (!expectedState || url.searchParams.get("state") !== expectedState) {
    return fail("State mismatch — try connecting again");
  }
  if (url.searchParams.get("error")) {
    return fail(url.searchParams.get("error") === "access_denied" ? "Access was denied" : (url.searchParams.get("error") ?? "Access was denied"));
  }

  const isMock = url.searchParams.get("mock") === "1";

  try {
    let externalId: string;
    let handle: string;
    let refreshToken: string;

    if (isMock) {
      externalId = "mock_yt_1";
      handle = "YouTube channel (mock)";
      refreshToken = `mock-token-${externalId}`;
    } else {
      const code = url.searchParams.get("code");
      if (!code) return fail("Missing authorization code");
      const c = await resolveOAuth(userId, "youtube");
      const cfg = c ? { ...c, redirectUri: oauthRedirectUri(new URL(req.url).origin, "youtube") } : undefined;
      const token = await youtubeExchangeCode(code, cfg);
      if (!token.refreshToken) {
        // No refresh token = the account can't publish past the 1h access-token
        // window. Almost always a prior grant re-authorized without consent.
        return fail("YouTube didn't return a refresh token — remove the app's access in your Google account, then reconnect");
      }
      const channel = await youtubeChannel(token.accessToken);
      externalId = channel.id;
      handle = channel.title;
      refreshToken = token.refreshToken;
    }

    // Never clobber a row owned by a different user.
    const existing = await db.socialAccount.findUnique({
      where: { platform_externalId: { platform: "youtube", externalId } },
    });
    if (existing && existing.userId !== userId) return fail("This YouTube channel belongs to another operator");

    const tokenRef = await storeSecret(refreshToken);
    const staleTokenRef = existing?.tokenRef ?? null;
    const base = {
      name: "YouTube",
      mark: "YT",
      handle,
      scopes: YOUTUBE_SCOPES,
      status: "connected",
      // Refresh tokens are durable (until revoked) — no "expiring" state.
      expiresAt: null,
      tokenRef,
      label: isMock ? "mock connection" : null,
      provenance: isMock ? "mock" : "real",
    };
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: "youtube", externalId } },
      update: base,
      create: { ...base, userId, platform: "youtube", externalId },
    });
    if (staleTokenRef && staleTokenRef !== tokenRef) await deleteSecret(staleTokenRef).catch(() => {});

    await audit("account.connect", { userId, ip: requestIp(req), metadata: { platform: "youtube", handle, mock: isMock } });
    return NextResponse.redirect(new URL("/accounts?connected=1", req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "YouTube connect failed";
    await audit("account.connect_failed", { userId, ip: requestIp(req), metadata: { platform: "youtube", error: msg.slice(0, 200) } });
    return fail(msg.slice(0, 200));
  }
}
