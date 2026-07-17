import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { presignUrl } from "@/lib/server/storage";
import type { VariantSet } from "@/lib/server/media";

/** GET /api/assets — the operator's library, each with a signed thumbnail URL
 * (originals stay private; the client never sees raw storage paths it could
 * fetch unsigned). */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Newest 500 — bounds payload and signed-URL minting as the library grows.
  const assets = await db.asset.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({
    assets: assets.map((a) => {
      let variants: VariantSet = {};
      try {
        variants = a.variants ? (JSON.parse(a.variants) as VariantSet) : {};
      } catch {
        /* tolerate legacy rows */
      }
      // Videos get a cover frame once processed; images use their thumb.
      const previewKey = variants.thumb ?? a.coverKey ?? (a.type === "image" ? a.storageKey : null);
      return {
        id: a.id,
        type: a.type,
        status: a.status,
        filename: a.filename,
        mime: a.mime,
        width: a.width,
        height: a.height,
        durationS: a.durationS,
        error: a.error,
        tags: a.tags,
        createdAt: a.createdAt,
        // 1h signed URLs — refetch the list to refresh.
        thumbUrl: previewKey ? presignUrl("GET", previewKey, 3600) : null,
        url: presignUrl("GET", a.storageKey, 3600),
      };
    }),
  });
}
