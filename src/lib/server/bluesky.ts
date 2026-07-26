/* Bluesky (AT Protocol) integration — researched against the official docs
 * (July 2026), not memory:
 *  - Auth: com.atproto.server.createSession {identifier, password} at the PDS
 *    entryway https://bsky.social → {did, handle, accessJwt, refreshJwt}.
 *    The credential is an APP PASSWORD (Bluesky → Settings → App Passwords),
 *    never the main password. accessJwt is short-lived, so the scheduler
 *    re-auths per publish with the stored app password (long-lived until the
 *    user revokes it) rather than persisting a fast-expiring token.
 *  - Publish: com.atproto.repo.createRecord, collection app.bsky.feed.post,
 *    record {$type, text, createdAt (ISO-8601 'Z'), facets?, embed?}
 *    → {uri: at://{did}/app.bsky.feed.post/{rkey}, cid}.
 *  - Facets index the text by UTF-8 BYTE offsets (byteStart inclusive,
 *    byteEnd exclusive) — links use feature app.bsky.richtext.facet#link{uri}.
 *  - Images: com.atproto.repo.uploadBlob (raw bytes, Content-Type = mime) →
 *    {blob}; embed app.bsky.embed.images{images:[{alt, image: blob}]}. Blob
 *    hard limit 1,000,000 bytes; up to 4 images per post.
 *  Sources: atproto.com/blog/create-post, docs.bsky.app rich-text guide.
 *
 * Why Bluesky is the first no-gatekeeper platform: no developer app, no OAuth,
 * no app review, no API fees — the credential is a per-account app password. */

import { PermanentError, type PublishResult } from "./publisher-errors";

const ENTRYWAY = "https://bsky.social";

/** app.bsky.feed.post lexicon limits. */
export const BLUESKY_MAX_TEXT = 300; // graphemes
export const BLUESKY_MAX_IMAGES = 4;
export const BLUESKY_BLOB_MAX_BYTES = 1_000_000;

/** App passwords are formatted xxxx-xxxx-xxxx-xxxx. Requiring this shape stops
 * an operator from pasting their MAIN password — which would authenticate, but
 * is a security foot-gun (unscoped, can't be revoked independently). */
const APP_PASSWORD_RE = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;
export function looksLikeAppPassword(pw: string): boolean {
  return APP_PASSWORD_RE.test(pw.trim());
}

export interface BlueskySession {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

/** Sign in with an app password. Bad credentials are permanent (need a fresh
 * connect); a 429/5xx at the entryway is transient (retry). */
export async function blueskyCreateSession(identifier: string, appPassword: string): Promise<BlueskySession> {
  let res: Response;
  try {
    res = await fetch(`${ENTRYWAY}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifier.replace(/^@/, ""), password: appPassword }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Could not reach Bluesky (network)");
  }
  const body = (await res.json().catch(() => ({}))) as {
    did?: string;
    handle?: string;
    accessJwt?: string;
    refreshJwt?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok || !body.accessJwt || !body.did) {
    const why =
      body.error === "AuthFactorTokenRequired"
        ? "this account requires an email 2FA code at sign-in, which app passwords can't provide"
        : (body.message ?? body.error ?? `HTTP ${res.status}`);
    if (res.status === 429 || res.status >= 500) throw new Error(`Bluesky sign-in failed (retryable): ${why}`);
    throw new PermanentError(`Bluesky rejected the credentials — ${why}`);
  }
  return {
    did: body.did,
    handle: body.handle ?? identifier.replace(/^@/, ""),
    accessJwt: body.accessJwt,
    refreshJwt: body.refreshJwt ?? "",
  };
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri: string }>;
}

/** Detect URLs and emit link facets with correct UTF-8 byte offsets. Bluesky
 * indexes facets by byte position into the UTF-8 encoding — NOT JS string
 * (UTF-16) offsets — so a multi-byte character before a link would misplace it
 * without this. Trailing punctuation is trimmed off the link (a URL at the end
 * of a sentence shouldn't swallow the period). */
export function buildLinkFacets(text: string): Facet[] {
  const facets: Facet[] = [];
  const re = /https?:\/\/[^\s]+/gi;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const url = m[0].replace(/[.,;:!?'")\]}>]+$/, "");
    if (!url) continue;
    const byteStart = Buffer.byteLength(text.slice(0, start), "utf8");
    const byteEnd = byteStart + Buffer.byteLength(url, "utf8");
    facets.push({ index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] });
  }
  return facets;
}

/** at://{did}/app.bsky.feed.post/{rkey} → the public web permalink. */
export function blueskyPermalink(handle: string, uri: string): string {
  const rkey = uri.split("/").pop() ?? "";
  return `https://bsky.app/profile/${handle.replace(/^@/, "")}/post/${rkey}`;
}

interface BlueskyBlob {
  $type: string;
  ref: { $link: string };
  mimeType: string;
  size: number;
}

/** An image ready for uploadBlob — bytes already fitted under the blob limit. */
export interface BlueskyImage {
  bytes: Buffer;
  mime: string;
  alt: string;
}

async function uploadBlob(accessJwt: string, img: BlueskyImage): Promise<BlueskyBlob> {
  if (img.bytes.length > BLUESKY_BLOB_MAX_BYTES) {
    // Caller is responsible for fitting; guard so we never send an oversize blob.
    throw new PermanentError(`Image is ${img.bytes.length} bytes — over Bluesky's ${BLUESKY_BLOB_MAX_BYTES}-byte blob limit`);
  }
  const res = await fetch(`${ENTRYWAY}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { "Content-Type": img.mime, Authorization: `Bearer ${accessJwt}` },
    body: img.bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as { blob?: BlueskyBlob; message?: string; error?: string };
  if (!res.ok || !body.blob) {
    const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new Error(`Bluesky image upload failed (retryable): ${msg}`);
    throw new PermanentError(`Bluesky rejected the image: ${msg}`);
  }
  return body.blob;
}

/** Build the app.bsky.feed.post record. `createdAt` is stamped by the caller so
 * this stays testable; facets/embed are attached only when present. */
export function buildPostRecord(
  text: string,
  createdAt: string,
  facets: Facet[],
  embed: Record<string, unknown> | null,
): Record<string, unknown> {
  const record: Record<string, unknown> = { $type: "app.bsky.feed.post", text, createdAt };
  if (facets.length) record.facets = facets;
  if (embed) record.embed = embed;
  return record;
}

/** Publish a post as the account: sign in, upload any images, create the
 * record. Everything before createRecord is safe to retry; once the record is
 * created the post is LIVE and nothing may throw (a retry would double-post). */
export async function publishBluesky(
  identifier: string,
  appPassword: string,
  text: string,
  images: BlueskyImage[] = [],
): Promise<PublishResult> {
  const session = await blueskyCreateSession(identifier, appPassword);

  let embed: Record<string, unknown> | null = null;
  if (images.length) {
    const uploaded: Array<{ alt: string; image: BlueskyBlob }> = [];
    for (const img of images.slice(0, BLUESKY_MAX_IMAGES)) {
      uploaded.push({ alt: img.alt, image: await uploadBlob(session.accessJwt, img) });
    }
    embed = { $type: "app.bsky.embed.images", images: uploaded };
  }

  const record = buildPostRecord(text, new Date().toISOString(), buildLinkFacets(text), embed);
  const res = await fetch(`${ENTRYWAY}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { uri?: string; cid?: string; message?: string; error?: string };
  if (!res.ok || !body.uri) {
    const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500 || /rate ?limit/i.test(msg)) {
      throw new Error(`Bluesky publish failed (retryable): ${msg}`);
    }
    throw new PermanentError(`Bluesky rejected the post: ${msg}`);
  }
  // LIVE from here — no throwing past this point.
  return { permalink: blueskyPermalink(session.handle, body.uri), externalMediaId: body.uri };
}
