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
import { validateVideoForPlatform } from "../video-specs";
import { publishLinkedInPost } from "./linkedin";
import { PermanentError, type PublishResult } from "./publisher-errors";

// Re-export the shared contracts — the worker and tests import them from here.
export { PermanentError, type PublishResult } from "./publisher-errors";

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
    return { permalink: target.permalink, externalMediaId: target.externalMediaId ?? null };
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
    return {
      permalink: `https://mock.qantm.local/${account.platform}/${postTargetId}`,
      externalMediaId: `mock_${postTargetId}`,
    };
  }

  switch (account.platform) {
    case "facebook":
      return publishFacebookPage(account.externalId, token, caption);
    case "linkedin":
      // Text posts via the versioned Posts API (w_member_social). Media posts
      // need the Images/Videos upload APIs — a follow-up wave.
      return publishLinkedInPost(account.externalId, token, caption);
    case "instagram": {
      const assetId = target.assetIds?.split(",")[0];
      if (!assetId) {
        throw new PermanentError("Instagram requires media — attach an image or video to this post");
      }
      const asset = await db.asset.findUnique({ where: { id: assetId } });
      if (!asset) throw new PermanentError("Attached media no longer exists");
      if (asset.status === "processing") {
        // Transcode still running — retryable; backoff will find it ready.
        throw new Error("Attached video is still transcoding");
      }
      if (asset.status === "failed") {
        throw new PermanentError(`Attached video failed processing: ${asset.error ?? "unknown error"}`);
      }
      let variants: Record<string, string> = {};
      try {
        variants = asset.variants ? (JSON.parse(asset.variants) as Record<string, string>) : {};
      } catch {
        /* fall back to original */
      }
      if (asset.type === "video") {
        // Videos that were still transcoding at scheduling time skipped spec
        // validation — enforce it here so an over-limit video fails with the
        // actual reason, not Meta's opaque container error.
        if (asset.durationS && asset.width && asset.height) {
          const problems = validateVideoForPlatform(account.platform, {
            durationS: asset.durationS,
            width: asset.width,
            height: asset.height,
            fps: 30,
            sizeMB: 0,
          });
          if (problems.length) throw new PermanentError(`Video violates ${account.name} limits: ${problems[0]}`);
        }
        // Reels flow — the 9:16 rendition, cover frame if we have one.
        return publishInstagramReel(
          account.externalId,
          token,
          caption,
          variants.vertical ?? asset.storageKey,
          asset.coverKey,
        );
      }
      // Image: prefer the 4:5 portrait variant; fall back to the original.
      return publishInstagram(account.externalId, token, caption, variants.portrait ?? asset.storageKey);
    }
    default:
      throw new PermanentError(`${account.name} publishing is not integrated yet (Waves 1–3)`);
  }
}

/** Instagram Reels flow (researched from Meta's IG-user/media reference):
 * container with media_type=REELS + video_url (Meta's servers fetch it —
 * public, no redirects), optional cover_url; upload is ASYNC, so poll
 * status_code until FINISHED before media_publish. */
async function publishInstagramReel(
  igUserId: string,
  token: string,
  caption: string,
  videoKey: string,
  coverKey: string | null,
): Promise<PublishResult> {
  const params: Record<string, string> = {
    media_type: "REELS",
    video_url: publicMediaUrl(videoKey, 3600),
    caption,
    access_token: token,
  };
  if (coverKey) params.cover_url = publicMediaUrl(coverKey, 3600);

  const container = await graphPost<{ id?: string }>(`/${igUserId}/media`, params);
  if (!container.id) throw new Error("Reels container creation returned no id");

  // Poll container processing — Meta ingests the video asynchronously.
  const deadline = Date.now() + 4 * 60_000;
  for (;;) {
    const status = await fetch(
      `${GRAPH}/${container.id}?${new URLSearchParams({ fields: "status_code", access_token: token })}`,
      { signal: AbortSignal.timeout(30_000) },
    ).then((r) => r.json() as Promise<{ status_code?: string }>);
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") {
      throw new PermanentError("Instagram could not process the Reel video (container ERROR)");
    }
    if (Date.now() > deadline) {
      // Still IN_PROGRESS — retryable; the next attempt creates a fresh container.
      throw new Error("Reel container still processing after 4 minutes");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const published = await graphPost<{ id?: string }>(`/${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  if (!published.id) throw new Error("Reel publish returned no media id");

  // Post is LIVE — permalink read-back stays best-effort. The media id is
  // NOT the URL shortcode, so the fallback must be a URL that actually
  // resolves: the account's profile page.
  let permalink = `https://www.instagram.com/${igUserId}`;
  try {
    const media = await fetch(
      `${GRAPH}/${published.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`,
      { signal: AbortSignal.timeout(15_000) },
    ).then((r) => r.json() as Promise<{ permalink?: string }>);
    if (media.permalink) permalink = media.permalink;
  } catch {
    // keep the fallback permalink
  }
  return { permalink, externalMediaId: published.id ?? null };
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
  return { permalink, externalMediaId: published.id ?? null };
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
    // Transient despite arriving as 4xx: "media not ready" (9007) during
    // async container processing, and Meta's application rate limits
    // (4, 17, 32, 613) — exactly what a burst of scheduled posts can hit.
    // Both must retry with backoff, not fail the post.
    const transient =
      body.error?.code === 9007 ||
      [4, 17, 32, 613].includes(body.error?.code ?? -1) ||
      /not ready/i.test(msg);
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
    // Meta application rate limits (4, 17, 32, 613) arrive as 4xx but are
    // transient — retry with backoff. Other 4xx (auth/permission) won't heal.
    const rateLimited = [4, 17, 32, 613].includes(body.error?.code ?? -1);
    if (res.status >= 400 && res.status < 500 && !rateLimited) {
      throw new PermanentError(`Facebook rejected the post: ${msg}`);
    }
    throw new Error(`Facebook publish failed: ${msg}`);
  }
  return { permalink: `https://www.facebook.com/${body.id}`, externalMediaId: body.id ?? null };
}
