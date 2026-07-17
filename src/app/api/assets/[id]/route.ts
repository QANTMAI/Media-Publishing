import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteObject } from "@/lib/server/storage";
import { variantKeys } from "@/lib/server/media";
import { audit, requestIp } from "@/lib/server/audit";

/** DELETE /api/assets/:id — remove the record, the original, and every
 * generated variant. Refused while a scheduled post still references it. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const asset = await db.asset.findFirst({ where: { id, userId } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inUse = await db.postTarget.count({
    where: {
      state: { in: ["scheduled", "publishing"] },
      post: { userId },
      OR: [{ assetIds: id }, { assetIds: { contains: `,${id}` } }, { assetIds: { contains: `${id},` } }],
    },
  });
  if (inUse > 0) {
    return NextResponse.json(
      { error: `In use by ${inUse} scheduled post${inUse > 1 ? "s" : ""} — cancel or reschedule them first` },
      { status: 409 },
    );
  }

  await db.asset.delete({ where: { id } });
  await deleteObject(asset.storageKey);
  for (const k of variantKeys(asset.variants)) await deleteObject(k);

  await audit("asset.delete", { userId, ip: requestIp(req), metadata: { assetId: id, filename: asset.filename } });
  return NextResponse.json({ ok: true });
}
