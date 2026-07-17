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

const GRAPH = "https://graph.facebook.com/v21.0";

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
    case "instagram":
      throw new PermanentError(
        "Instagram publishing requires hosted media (container flow) — blocked on the media pipeline (T-106)",
      );
    default:
      throw new PermanentError(`${account.name} publishing is not integrated yet (Waves 1–3)`);
  }
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
