/* LinkedIn integration — researched against the current official docs
 * (July 2026), not memory:
 *  - 3-legged OAuth: learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 *  - Member identity: OpenID Connect userinfo ("Sign In with LinkedIn using
 *    OpenID Connect" product) — the `sub` claim is the member id for the
 *    urn:li:person:{sub} author URN.
 *  - Publishing: versioned Posts API (POST /rest/posts) — accepts
 *    w_member_social for member posts; requires LinkedIn-Version: YYYYMM and
 *    X-Restli-Protocol-Version: 2.0.0. 201 + x-restli-id header = post URN.
 *    learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api
 *
 * Facts encoded below (from those docs):
 *  - Access tokens live 60 days (expires_in=5184000). Programmatic refresh is
 *    partner-only; standard apps re-run the OAuth flow (consent screen is
 *    bypassed while the member is logged in and the token unexpired) — so the
 *    portal marks accounts "expiring" and offers Reconnect.
 *  - There is NO documented token-revocation endpoint. Disconnect deletes our
 *    vault copy (cuts our access); the grant itself dies at the 60-day expiry
 *    or when the member removes the app in LinkedIn settings.
 *  - Rate limit (Share on LinkedIn): 150 requests/day/member.
 *  - Error semantics per the Posts API error table: 400/401/403/404/422 are
 *    permanent for a given request; 409/429/5xx are retryable. */

import { PermanentError, type PublishResult } from "./publisher-errors";

const AUTH_BASE = "https://www.linkedin.com/oauth/v2";
const API_BASE = "https://api.linkedin.com";

/** Versioned-API month header. Pinned to a documented supported version
 * (li-lms-2026-06); override via env when LinkedIn sunsets it. */
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION ?? "202506";

/** Scopes: identity (openid+profile via the "Sign In with LinkedIn using
 * OpenID Connect" product) + posting (w_member_social via "Share on
 * LinkedIn"). Both products are self-serve in the developer portal. */
export const LINKEDIN_SCOPES = "openid profile w_member_social";

export function linkedinConfigured(): boolean {
  return !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET && process.env.LINKEDIN_REDIRECT_URI);
}

export function linkedinAuthUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${AUTH_BASE}/authorization?${p}`;
}

export interface LinkedInToken {
  accessToken: string;
  /** Seconds until expiry (docs: 60 days = 5184000). */
  expiresIn: number;
}

/** Exchange the authorization code (30-minute lifespan) for an access token.
 * Per docs: form-encoded POST; token ~500 chars (plan for 1000+). */
export async function linkedinExchangeCode(code: string): Promise<LinkedInToken> {
  const res = await fetch(`${AUTH_BASE}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`LinkedIn token exchange failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 5184000 };
}

export interface LinkedInMember {
  /** OpenID `sub` claim — the member id used in urn:li:person:{sub}. */
  sub: string;
  name: string;
}

/** OpenID Connect userinfo — identifies the member who granted access. */
export async function linkedinUserinfo(accessToken: string): Promise<LinkedInMember> {
  const res = await fetch(`${API_BASE}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { sub?: string; name?: string };
  if (!res.ok || !body.sub) throw new Error(`LinkedIn userinfo failed: HTTP ${res.status}`);
  return { sub: body.sub, name: body.name ?? "LinkedIn member" };
}

/** The Posts API `commentary` field uses LinkedIn's "little" text format,
 * where these characters are reserved (templates for mentions etc.) and must
 * be backslash-escaped to render literally. `#` is deliberately NOT escaped —
 * plain #hashtags are valid and get templated server-side (doc example:
 * "Follow best practices #coding"). */
const LITTLE_RESERVED = /[\\|{}@[\]()<>*_~]/g;
export function escapeLittleText(text: string): string {
  return text.replace(LITTLE_RESERVED, (c) => `\\${c}`);
}

/** Build the documented minimal text-post body for POST /rest/posts. */
export function buildLinkedInPostBody(personId: string, commentary: string) {
  return {
    author: `urn:li:person:${personId}`,
    commentary: escapeLittleText(commentary),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

/** Classify a Posts API failure per the documented error table.
 * Permanent: 400 (bad request won't heal), 401/403 (token dead or scope
 * missing — needs Reconnect), 404, 422. Retryable: 409 CONFLICT ("retry the
 * request" per docs), 429 rate limit, 5xx. */
export function classifyLinkedInError(status: number, message: string): Error {
  if (status === 409 || status === 429 || status >= 500) {
    return new Error(`LinkedIn publish failed (retryable): ${message}`);
  }
  if (status === 401 || status === 403) {
    return new PermanentError(`LinkedIn rejected the credentials (${status}) — reconnect the account: ${message}`);
  }
  return new PermanentError(`LinkedIn rejected the post: ${message}`);
}

/** Publish a text post as the member. Returns the live permalink
 * (https://www.linkedin.com/feed/update/{urn}/ per docs) and the post URN. */
export async function publishLinkedInPost(
  personId: string,
  accessToken: string,
  commentary: string,
): Promise<PublishResult> {
  const res = await fetch(`${API_BASE}/rest/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_VERSION,
    },
    body: JSON.stringify(buildLinkedInPostBody(personId, commentary)),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status !== 201) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw classifyLinkedInError(res.status, body.message ?? body.code ?? `HTTP ${res.status}`);
  }

  // 201 Created — the x-restli-id header carries the post URN
  // (urn:li:share:… or urn:li:ugcPost:…).
  const urn = res.headers.get("x-restli-id");
  if (!urn) {
    // Post IS live (201) — never throw here or a retry would double-post.
    return { permalink: "https://www.linkedin.com/feed/", externalMediaId: null };
  }
  return { permalink: `https://www.linkedin.com/feed/update/${urn}/`, externalMediaId: urn };
}
