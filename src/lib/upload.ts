"use client";

/* Client upload flow (Build Plan §04): presign → PUT bytes directly to
 * storage → complete (server validates, generates variants, records the
 * Asset). Throws with a human-readable message on any failure. */

export interface UploadedAsset {
  id: string;
  type: "image" | "video";
  filename: string;
  thumbUrl: string | null;
}

export async function uploadAsset(file: File, tags?: string): Promise<UploadedAsset> {
  const kind = file.type.startsWith("video/") ? "video" : "image";

  const presign = await fetch("/api/assets/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, mime: file.type, size: file.size, filename: file.name }),
  });
  if (!presign.ok) throw new Error((await presign.json()).error ?? "Upload rejected");
  const { key, putUrl } = await presign.json();

  const put = await fetch(putUrl, { method: "PUT", body: file });
  if (!put.ok) throw new Error((await put.json().catch(() => ({}))).error ?? "Upload failed");

  const complete = await fetch("/api/assets/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, mime: file.type, filename: file.name, tags }),
  });
  if (!complete.ok) throw new Error((await complete.json()).error ?? "Processing failed");
  return complete.json();
}

export interface AssetListItem {
  id: string;
  type: "image" | "video";
  filename: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  tags: string | null;
  createdAt: string;
  thumbUrl: string | null;
  url: string;
}

export async function listAssets(): Promise<AssetListItem[]> {
  const res = await fetch("/api/assets");
  if (!res.ok) return [];
  return (await res.json()).assets;
}
