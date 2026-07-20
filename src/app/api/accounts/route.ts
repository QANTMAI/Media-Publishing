import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";

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
  return NextResponse.json({ accounts });
}
