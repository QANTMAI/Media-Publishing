import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteSecret, storeSecret } from "@/lib/server/vault";
import { audit, requestIp } from "@/lib/server/audit";
import { discoverAccounts, exchangeCode, META_SCOPES, type DiscoveredAccount } from "@/lib/server/meta";

// Mock grants target the seeded demo rows (same external ids) so connecting
// "activates" them instead of duplicating handles in the account list.
const MOCK_ACCOUNTS: Array<Omit<DiscoveredAccount, "pageToken">> = [
  { platform: "instagram", externalId: "demo_ig_1", handle: "@qantm.media" },
  { platform: "instagram", externalId: "demo_ig_2", handle: "@qantm.studio" },
  { platform: "instagram", externalId: "demo_ig_3", handle: "@qantm.behindthescenes" },
  { platform: "facebook", externalId: "demo_fb_1", handle: "QANTM Media" },
  { platform: "facebook", externalId: "demo_fb_2", handle: "QANTM Community" },
];

/** GET /api/oauth/meta/callback — finish the grant: exchange the code, store
 * tokens in the vault, upsert SocialAccount rows, land on /accounts. */
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
  let discovered: DiscoveredAccount[];
  let expiresAt: Date;

  try {
    if (isMock) {
      discovered = MOCK_ACCOUNTS.map((a) => ({ ...a, pageToken: `mock-token-${a.externalId}` }));
      expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60);
    } else {
      const code = url.searchParams.get("code");
      if (!code) return fail("Missing authorization code");
      const { token, expiresIn } = await exchangeCode(code);
      expiresAt = new Date(Date.now() + expiresIn * 1000);
      discovered = await discoverAccounts(token);
      if (!discovered.length) return fail("No Pages or Instagram business accounts on this profile");
    }

    let connected = 0;
    for (const acc of discovered) {
      // Never clobber a row owned by a different user (future multi-operator
      // safety): skip instead of transferring ownership.
      const existing = await db.socialAccount.findUnique({
        where: { platform_externalId: { platform: acc.platform, externalId: acc.externalId } },
      });
      if (existing && existing.userId !== userId) continue;

      const tokenRef = await storeSecret(acc.pageToken);
      try {
        const base = {
          name: acc.platform === "instagram" ? "Instagram" : "Facebook",
          mark: acc.platform === "instagram" ? "IG" : "FB",
          handle: acc.handle,
          scopes: META_SCOPES,
          status: "connected",
          expiresAt,
          tokenRef,
          label: isMock ? "mock connection" : null,
          provenance: isMock ? "mock" : "real",
        };
        const staleTokenRef = existing?.tokenRef ?? null;
        await db.socialAccount.upsert({
          where: { platform_externalId: { platform: acc.platform, externalId: acc.externalId } },
          create: { ...base, userId, platform: acc.platform, externalId: acc.externalId },
          update: base,
        });
        // The row now points at the new secret; drop the superseded one.
        if (staleTokenRef && staleTokenRef !== tokenRef) await deleteSecret(staleTokenRef);
        connected += 1;
      } catch (err) {
        // No orphaned ciphertext: an unlinked vault row is deleted on failure.
        await deleteSecret(tokenRef);
        throw err;
      }
    }

    await audit("account.connect", {
      userId,
      ip: requestIp(req),
      metadata: { provider: "meta", accounts: connected, mock: isMock },
    });
    return NextResponse.redirect(new URL(`/accounts?connected=${connected}`, req.url));
  } catch (err) {
    console.error("meta oauth callback failed", err);
    return fail("Connection failed — see server logs");
  }
}
