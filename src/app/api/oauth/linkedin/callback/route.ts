import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteSecret, storeSecret } from "@/lib/server/vault";
import { audit, requestIp } from "@/lib/server/audit";
import { LINKEDIN_SCOPES, linkedinExchangeCode, linkedinUserinfo } from "@/lib/server/linkedin";

/** GET /api/oauth/linkedin/callback — finish the grant: verify state,
 * exchange the code, resolve the member via OpenID userinfo, store the token
 * in the vault, upsert the SocialAccount row, land on /accounts.
 *
 * Docs facts encoded here: authorization codes live 30 minutes; the callback
 * signals member cancellation via error=user_cancelled_login|
 * user_cancelled_authorize (+ error_description); tokens live 60 days. */
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
    return fail(url.searchParams.get("error_description") ?? "Access was denied");
  }

  const isMock = url.searchParams.get("mock") === "1";

  try {
    let externalId: string;
    let handle: string;
    let accessToken: string;
    let expiresAt: Date;

    if (isMock) {
      externalId = "mock_li_1";
      handle = "LinkedIn member (mock)";
      accessToken = `mock-token-${externalId}`;
      expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60);
    } else {
      const code = url.searchParams.get("code");
      if (!code) return fail("Missing authorization code");
      const token = await linkedinExchangeCode(code);
      const member = await linkedinUserinfo(token.accessToken);
      externalId = member.sub;
      handle = member.name;
      accessToken = token.accessToken;
      expiresAt = new Date(Date.now() + token.expiresIn * 1000);
    }

    // Never clobber a row owned by a different user.
    const existing = await db.socialAccount.findUnique({
      where: { platform_externalId: { platform: "linkedin", externalId } },
    });
    if (existing && existing.userId !== userId) return fail("This LinkedIn account belongs to another operator");

    const tokenRef = await storeSecret(accessToken);
    const staleTokenRef = existing?.tokenRef ?? null;
    const base = {
      name: "LinkedIn",
      mark: "IN",
      handle,
      scopes: LINKEDIN_SCOPES,
      status: "connected",
      expiresAt,
      tokenRef,
      label: isMock ? "mock connection" : null,
    };
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: "linkedin", externalId } },
      update: base,
      create: { ...base, userId, platform: "linkedin", externalId },
    });
    // Replaced token: drop the old ciphertext once the row points at the new one.
    if (staleTokenRef && staleTokenRef !== tokenRef) await deleteSecret(staleTokenRef).catch(() => {});

    await audit("account.connect", {
      userId,
      ip: requestIp(req),
      metadata: { platform: "linkedin", handle, mock: isMock },
    });
    return NextResponse.redirect(new URL("/accounts?connected=1", req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LinkedIn connect failed";
    await audit("account.connect_failed", { userId, ip: requestIp(req), metadata: { platform: "linkedin", error: msg.slice(0, 200) } });
    return fail(msg.slice(0, 200));
  }
}
