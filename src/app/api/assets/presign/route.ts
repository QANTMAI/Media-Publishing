import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { newStorageKey, presignUrl } from "@/lib/server/storage";
import { extForMime, validateUpload, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/server/media";
import { rateLimited } from "@/lib/server/rate-limit";

/** POST /api/assets/presign — start an upload: validate the declared file,
 * mint a server-chosen storage key and a short-lived signed PUT URL. The
 * client uploads bytes directly to storage, then calls /api/assets/complete.
 * Rate limited: presigned PUT slots are disk-write capability. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (rateLimited(`presign:${userId}`, 60, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many uploads — try again later" }, { status: 429 });
  }

  const { kind, mime, size, filename } = (await req.json().catch(() => ({}))) as {
    kind?: "image" | "video";
    mime?: string;
    size?: number;
    filename?: string;
  };
  if (kind !== "image" && kind !== "video") {
    return NextResponse.json({ error: "kind must be image|video" }, { status: 400 });
  }
  const problem = validateUpload(kind, mime ?? "", size ?? 0);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  if (!filename?.trim()) return NextResponse.json({ error: "filename required" }, { status: 400 });

  const key = newStorageKey(extForMime(mime!));
  // The kind's byte cap is signed into the PUT URL — enforced at the storage
  // door, not just declared here.
  const cap = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  return NextResponse.json({
    key,
    putUrl: presignUrl("PUT", key, 600, cap), // 10 minutes to finish the upload
  });
}
