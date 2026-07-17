/* Publisher (Build Plan §04): called by the worker for one due PostTarget.
 * Decrypts the account token, calls the platform's publishing API, returns
 * the live permalink. Errors are classified: PermanentError fails the target
 * immediately (no retry can fix a missing integration or missing token);
 * anything else is retryable with backoff.
 *
 * Real today: Facebook Page text posts via Graph API (when real tokens
 * exist). Instagram requires hosted media, which lands with the media
 * pipeline (T-106) — until then a real IG publish is a PermanentError, not a
 * silent fake. Mock tokens (OAUTH_MOCK grants) publish to a labeled mock
 * permalink so the pipeline is exercisable end to end. */

import { db } from "./db";
import { readSecret } from "./vault";
import { presignUrl } from "./storage";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Absolute, platform-fetchable URL for a stored object. Platforms download
 * media from us, so the app needs a public origin (production). */
function publicMediaUrl(key: string, ttlSeconds: number): string {
  const origin = process.env.PUBLIC_ORIGIN;
  if (!origin) {
    throw new PermanentError(
      "PUBLIC_ORIGIN is not configured — platforms must be able to fetch media from this portal",
    );
  }
  return origin.replace(/\/$/, "") + presignUrl("GET", key, ttlSeconds);
}

export class PermanentError extends Error {
  permanent = true as const;
}

export interface PublishResult {
  permalink: string;
}

export async function publishTarget(postTargetId: string): Promise<PublishResult> {
  const target = await db.postTarget.findUnique({
    where: { id: postTargetId },
    include: { post: true, account: true },
  });
  if (!target) throw new PermanentError("Post target no longer exists");
  const { account, post } = target;

  // Idempotency: if a previous cycle published but crashed before closing the
  // job, a reclaimed job must NOT publish again — return the recorded result.
  if (target.state === "published" && target.permalink) {
    return { permalink: target.permalink };
  }

  if (account.status === "paused") {
    // Held, not failed — the worker reschedules paused-account jobs.
    throw new Error("Account is paused");
  }
  if (account.status === "disconnected" || !account.tokenRef) {
    throw new PermanentError(`${account.name} (${account.handle}) is not connected — no credentials in vault`);
  }

  const token = await readSecret(account.tokenRef);
  if (!token) throw new PermanentError("Vault token missing — reconnect the account");

  const caption = target.captionOverride?.trim() || post.baseCaption;

  if (token.startsWith("mock-token-")) {
    // OAUTH_MOCK grant: simulate a successful publish, clearly labeled.
    return { permalink: `https://mock.qantm.local/${account.platform}/${postTargetId}` };
  }

  switch (account.platform) {
    case "facebook":
      return publishFacebookPage(account.externalId, token, caption);
    case "instagram": {
      const assetId = target.assetIds?.split(",")[0];
      if (!assetId) {
        throw new PermanentError("Instagram requires media — attach an image to this post");
      }
      const asset = await db.asset.findUnique({ where: { id: assetId } });
      if (!asset) throw new PermanentError("Attached media no longer exists");
      if (asset.type !== "image") {
        throw new PermanentError("Instagram video (Reels) publishing lands with the video pipeline (T-302)");
      }
      // Prefer the 4:5 portrait variant; fall back to the original.
      let mediaKey = asset.storageKey;
      try {
        const variants = asset.variants ? (JSON.parse(asset.variants) as { portrait?: string }) : {};
        if (variants.portrait) mediaKey = variants.portrait;
      } catch {
        /* use original */
      }
      return publishInstagram(account.externalId, token, caption, mediaKey);
    }
    default:
      throw new PermanentError(`${account.name} publishing is not integrated yet (Waves 1–3)`);
  }
}

/** Instagram container flow: create a media container from a hosted image
 * URL, publish it, then read back the permalink. */
async function publishInstagram(
  igUserId: string,
  token: string,
  caption: string,
  mediaKey: string,
): Promise<PublishResult> {
  const imageUrl = publicMediaUrl(mediaKey, 3600);

  const container = await graphPost<{ id?: string }>(`/${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: token,
  });
  if (!container.id) throw new Error("Instagram container creation returned no id");

  const published = await graphPost<{ id?: string }>(`/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  if (!published.id) throw new Error("Instagram publish returned no media id");

  // The post is LIVE from here on — nothing below may throw, or the worker's
  // retry would create a duplicate. The permalink read-back is cosmetic;
  // fall back to the media id on any failure.
  let permalink = `https://www.instagram.com/p/${published.id}`;
  try {
    const media = await fetch(
      `${GRAPH}/${published.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`,
      { signal: AbortSignal.timeout(15_000) },
    ).then((r) => r.json() as Promise<{ permalink?: string }>);
    if (media.permalink) permalink = media.permalink;
  } catch {
    // keep the fallback permalink
  }
  return { permalink };
}

async function graphPost<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    // IG processes containers asynchronously: "media not ready" (code 9007)
    // is transient even though it arrives as a 4xx — retry it with backoff.
    const transient = body.error?.code === 9007 || /not ready/i.test(msg);
    if (res.status >= 400 && res.status < 500 && !transient) {
      throw new PermanentError(`Instagram rejected the post: ${msg}`);
    }
    throw new Error(`Instagram publish failed: ${msg}`);
  }
  return body;
}

async function publishFacebookPage(pageId: string, pageToken: string, message: string): Promise<PublishResult> {
  // Bounded: a hung request must not outlive the queue's stale-claim window.
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: pageToken }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || !body.id) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    // 4xx auth/permission errors won't heal on retry; transport/5xx might.
    if (res.status >= 400 && res.status < 500) throw new PermanentError(`Facebook rejected the post: ${msg}`);
    throw new Error(`Facebook publish failed: ${msg}`);
  }
  return { permalink: `https://www.facebook.com/${body.id}` };
}
