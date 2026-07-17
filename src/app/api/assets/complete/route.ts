import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { deleteObject, getObject, objectSize, presignUrl } from "@/lib/server/storage";
import { extForMime, processImage, validateUpload, IMAGE_MIMES } from "@/lib/server/media";
import { audit, requestIp } from "@/lib/server/audit";

/** POST /api/assets/complete — finish an upload: verify the bytes actually
 * landed and re-validate them server-side (the presign only checked the
 * client's declaration), generate image variants, create the Asset record. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key, mime, filename, tags } = (await req.json().catch(() => ({}))) as {
    key?: string;
    mime?: string;
    filename?: string;
    tags?: string;
  };
  if (!key || !mime || !filename?.trim()) {
    return NextResponse.json({ error: "key, mime, filename required" }, { status: 400 });
  }
  // The key must be unclaimed — completing someone's key twice is refused.
  const existing = await db.asset.findFirst({ where: { storageKey: key } });
  if (existing) return NextResponse.json({ error: "Already completed" }, { status: 409 });

  // The key's extension was derived from the presigned mime; a different
  // mime here would make the stored record and the served Content-Type
  // disagree. Refuse the mismatch instead of storing a lie.
  if (!key.endsWith(`.${extForMime(mime)}`)) {
    return NextResponse.json({ error: "mime does not match the presigned upload" }, { status: 400 });
  }

  const kind = IMAGE_MIMES[mime] ? ("image" as const) : ("video" as const);
  const size = await objectSize(key);
  if (size == null) return NextResponse.json({ error: "No uploaded file at this key" }, { status: 404 });
  const problem = validateUpload(kind, mime, size);
  if (problem) {
    await deleteObject(key); // don't keep invalid bytes around
    return NextResponse.json({ error: problem }, { status: 422 });
  }

  let width: number | null = null;
  let height: number | null = null;
  let variantsJson: string | null = null;
  // Images are ready synchronously; videos transcode in the worker (ffmpeg
  // is CPU-bound and must not run in the request path).
  const status = kind === "image" ? "ready" : "processing";

  if (kind === "image") {
    const data = await getObject(key);
    if (!data) return NextResponse.json({ error: "No uploaded file at this key" }, { status: 404 });
    try {
      const processed = await processImage(key, data);
      width = processed.width;
      height = processed.height;
      variantsJson = JSON.stringify(processed.variants);
    } catch (err) {
      await deleteObject(key);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Image processing failed" },
        { status: 422 },
      );
    }
  }
  const asset = await db.asset.create({
    data: {
      userId,
      type: kind,
      status,
      storageKey: key,
      filename: filename.trim().slice(0, 200),
      mime,
      width,
      height,
      variants: variantsJson,
      tags: tags?.trim() || null,
    },
  });

  await audit("asset.upload", {
    userId,
    ip: requestIp(req),
    metadata: { assetId: asset.id, kind, bytes: size, ext: extForMime(mime) },
  });
  let thumbUrl: string | null = null;
  if (variantsJson) {
    const v = JSON.parse(variantsJson) as { thumb?: string };
    if (v.thumb) thumbUrl = presignUrl("GET", v.thumb, 3600);
  }
  return NextResponse.json(
    { id: asset.id, type: kind, filename: asset.filename, thumbUrl, status },
    { status: 201 },
  );
}
