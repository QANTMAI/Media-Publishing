import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { oauthConfiguredFor } from "@/lib/server/oauth-config";

/** GET /api/accounts — the operator's connected-account rows. Tokens never
 * appear here; only status/metadata. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.socialAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      platform: true,
      name: true,
      mark: true,
      handle: true,
      label: true,
      provenance: true,
      status: true,
      expiresAt: true,
      // Post count powers the Remove confirmation ("deletes N posts").
      _count: { select: { targets: true } },
    },
  });
  const accounts = rows.map(({ _count, ...a }) => ({ ...a, postCount: _count.targets }));
  // Product ordering (wave order), not alphabetical.
  const ORDER = ["instagram", "facebook", "x", "linkedin", "youtube", "tiktok", "threads", "bluesky", "pinterest", "gbp"];
  accounts.sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform));
  // Which OAuth platforms have real credentials configured — the UI uses this
  // to show "Needs setup" instead of letting a Connect create a mock. Bluesky
  // needs no app (app password), so it's always connectable.
  const configured = {
    meta: await oauthConfiguredFor(userId, "meta"),
    linkedin: await oauthConfiguredFor(userId, "linkedin"),
    youtube: await oauthConfiguredFor(userId, "youtube"),
    bluesky: true,
  };
  return NextResponse.json({ accounts, configured });
}
