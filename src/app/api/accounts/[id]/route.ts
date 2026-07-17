import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteSecret, readSecret } from "@/lib/server/vault";
import { audit, requestIp } from "@/lib/server/audit";
import { revokeMetaToken } from "@/lib/server/meta";

/** PATCH /api/accounts/:id — pause / resume. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!status || !["connected", "paused"].includes(status)) {
    return NextResponse.json({ error: "status must be connected|paused" }, { status: 400 });
  }

  const account = await db.socialAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (account.status === "disconnected") {
    return NextResponse.json({ error: "Connect the account first" }, { status: 409 });
  }

  const updated = await db.socialAccount.update({ where: { id }, data: { status } });
  await audit(status === "paused" ? "account.pause" : "account.resume", {
    userId,
    ip: requestIp(req),
    metadata: { account: account.handle, platform: account.platform },
  });
  return NextResponse.json({ account: updated });
}

/** DELETE /api/accounts/:id — disconnect: revoke platform-side (best effort),
 * delete the vault token, mark disconnected. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const account = await db.socialAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (account.tokenRef) {
    const token = await readSecret(account.tokenRef);
    const metaFamily = ["instagram", "facebook", "threads"];
    if (token && metaFamily.includes(account.platform) && !token.startsWith("mock-token-")) {
      // Meta's /me/permissions revoke kills the WHOLE user grant, not one
      // page — only call it when this is the last connected Meta account,
      // otherwise the operator's other pages would silently start failing.
      const remaining = await db.socialAccount.count({
        where: {
          userId,
          id: { not: id },
          platform: { in: metaFamily },
          tokenRef: { not: null },
          status: { in: ["connected", "expiring", "paused"] },
        },
      });
      if (remaining === 0) {
        await revokeMetaToken(token).catch(() => {
          // Platform-side revoke is best effort; local deletion still cuts our access.
        });
      }
    }
    // Must clear the FK before the vault row can go.
    await db.socialAccount.update({ where: { id }, data: { tokenRef: null } });
    await deleteSecret(account.tokenRef);
  }

  const updated = await db.socialAccount.update({
    where: { id },
    data: { status: "disconnected", scopes: null, expiresAt: null },
  });
  await audit("account.disconnect", {
    userId,
    ip: requestIp(req),
    metadata: { account: account.handle, platform: account.platform },
  });
  return NextResponse.json({ account: updated });
}
