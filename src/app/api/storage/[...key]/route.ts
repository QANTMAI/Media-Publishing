import { NextResponse } from "next/server";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rm, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { storagePathFor, verifySignature } from "@/lib/server/storage";
import { MAX_VIDEO_BYTES } from "@/lib/server/media";

/* The only door to the private media store. Every request — read or write —
 * must carry a valid, unexpired HMAC signature minted by the server for this
 * exact method + key. No listing, no unsigned access, no client-chosen keys. */

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function keyFrom(params: { key: string[] }): string {
  return params.key.join("/");
}

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const key = keyFrom(await ctx.params);
  const url = new URL(req.url);
  if (!verifySignature("GET", key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }
  // Stream from disk — a 500MB video must not be buffered in memory.
  let size: number;
  const abs = storagePathFor(key);
  try {
    size = (await stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = key.split(".").pop() ?? "";
  const stream = Readable.toWeb(createReadStream(abs)) as globalThis.ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // Never let a browser second-guess the type of served media.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(size),
    },
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const key = keyFrom(await ctx.params);
  const url = new URL(req.url);
  // The byte cap is part of the signature — tampering with ?max= breaks it.
  const maxBytes = Number(url.searchParams.get("max") ?? 0) || 0;
  if (!verifySignature("PUT", key, url.searchParams.get("exp"), url.searchParams.get("sig"), maxBytes)) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }
  if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  const byteCap = maxBytes > 0 ? Math.min(maxBytes, MAX_VIDEO_BYTES) : MAX_VIDEO_BYTES;

  // Stream to disk with a hard byte cap — large videos must not be buffered
  // in memory, and a lying Content-Length must not bypass the cap.
  const abs = storagePathFor(key);
  await mkdir(path.dirname(abs), { recursive: true });
  const out = createWriteStream(abs);
  let received = 0;
  try {
    const reader = (Readable.fromWeb(req.body as import("stream/web").ReadableStream) as Readable)[
      Symbol.asyncIterator
    ]();
    for await (const chunk of { [Symbol.asyncIterator]: () => reader }) {
      received += (chunk as Buffer).length;
      if (received > byteCap) throw new Error("too-large");
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(() => resolve());
    });
    return NextResponse.json({ ok: true, bytes: received }, { status: 201 });
  } catch (err) {
    out.destroy();
    await rm(abs, { force: true });
    if (err instanceof Error && err.message === "too-large") {
      return NextResponse.json({ error: "File exceeds the size cap" }, { status: 413 });
    }
    console.error("storage PUT failed", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
