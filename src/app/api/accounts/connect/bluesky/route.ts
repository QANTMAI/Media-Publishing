import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { storeSecret, deleteSecret } from "@/lib/server/vault";
import { audit, requestIp } from "@/lib/server/audit";
import { blueskyCreateSession, looksLikeAppPassword } from "@/lib/server/bluesky";

/** POST /api/accounts/connect/bluesky — connect a Bluesky account with an app
 * password (Bluesky's real auth model: no OAuth, no developer app). We verify
 * the credentials against the PDS, store the app password encrypted in the same
 * vault as OAuth tokens, and upsert the SocialAccount row (real provenance).
 *
 * The app password (not a fast-expiring session token) is what's stored: the
 * scheduler re-authenticates per publish, so a post scheduled days out still
 * works. It's revocable in Bluesky's settings independently of the main
 * password — which is exactly why we require the app-password format here. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const identifier = String(body.identifier ?? "").trim().replace(/^@/, "");
  const appPassword = String(body.appPassword ?? "").trim();

  if (!identifier || !appPassword) {
    return NextResponse.json({ error: "Enter your Bluesky handle and an app password." }, { status: 422 });
  }
  if (!looksLikeAppPassword(appPassword)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like an app password (xxxx-xxxx-xxxx-xxxx). Create one in Bluesky → Settings → App Passwords — don't use your main password.",
      },
      { status: 422 },
    );
  }

  let session;
  try {
    session = await blueskyCreateSession(identifier, appPassword);
  } catch (err) {
    await audit("account.connect_failed", { userId, ip: requestIp(req), metadata: { platform: "bluesky" } });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not reach Bluesky" }, { status: 400 });
  }

  // Store the app password; replace any prior secret for this same account.
  const tokenRef = await storeSecret(appPassword);
  const existing = await db.socialAccount.findUnique({
    where: { platform_externalId: { platform: "bluesky", externalId: session.did } },
  });
  if (existing?.tokenRef) await deleteSecret(existing.tokenRef);

  const account = await db.socialAccount.upsert({
    where: { platform_externalId: { platform: "bluesky", externalId: session.did } },
    update: { status: "connected", tokenRef, provenance: "real", handle: `@${session.handle}`, name: "Bluesky" },
    create: {
      userId,
      platform: "bluesky",
      externalId: session.did,
      name: "Bluesky",
      mark: "BS",
      handle: `@${session.handle}`,
      provenance: "real",
      status: "connected",
      tokenRef,
    },
  });

  await audit("account.connect", { userId, ip: requestIp(req), metadata: { platform: "bluesky", handle: session.handle } });
  return NextResponse.json({ ok: true, account: { handle: account.handle, name: account.name } }, { status: 201 });
}
