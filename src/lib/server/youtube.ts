/* YouTube (Data API v3) integration — researched against the official Google
 * docs (July 2026), not memory:
 *  - OAuth 2.0 web-server flow: accounts.google.com/o/oauth2/v2/auth with
 *    access_type=offline + prompt=consent to reliably get a refresh_token;
 *    exchange/refresh at oauth2.googleapis.com/token.
 *    developers.google.com/identity/protocols/oauth2/web-server
 *  - Upload: RESUMABLE protocol — POST metadata to
 *    /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status with
 *    X-Upload-Content-Length / X-Upload-Content-Type → 200 + a session URI in
 *    the Location header; PUT the bytes there → 200/201 with the video resource.
 *    developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 *  - Identity: channels.list?mine=true&part=snippet → the channel id + title.
 *
 * Facts encoded below (from those docs):
 *  - Access tokens live ~1 hour; the durable credential is the refresh_token,
 *    so the scheduler stores the refresh_token and mints an access token per
 *    publish (mirrors how a client library behaves).
 *  - videos.insert costs ~1600 quota units; the default daily quota is 10,000
 *    units (~6 uploads/day) until a quota increase is granted.
 *  - UNAUDITED-APP RESTRICTION: until the app passes YouTube's API compliance
 *    audit, videos uploaded via youtube.upload are locked to PRIVATE regardless
 *    of the requested privacyStatus. This is YouTube's behavior, surfaced
 *    honestly rather than worked around.
 *  - Scopes youtube.upload + youtube.readonly are "restricted" — production use
 *    requires OAuth verification; the operator's own Google account works as a
 *    test user before that. */

import { PermanentError, type PublishResult } from "./publisher-errors";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";

/** youtube.upload publishes; youtube.readonly resolves the channel identity. */
export const YOUTUBE_SCOPES =
  "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

/** YouTube metadata caps (videos resource). */
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
/** "People & Blogs" — a safe, always-valid default category. */
export const YT_DEFAULT_CATEGORY = "22";

export function youtubeConfigured(): boolean {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URI);
}

export function youtubeAuthUrl(state: string, cfg?: { clientId: string; redirectUri: string }): string {
  const p = new URLSearchParams({
    client_id: cfg?.clientId ?? process.env.YOUTUBE_CLIENT_ID!,
    redirect_uri: cfg?.redirectUri ?? process.env.YOUTUBE_REDIRECT_URI!,
    response_type: "code",
    scope: YOUTUBE_SCOPES,
    access_type: "offline", // required for a refresh_token
    prompt: "consent", // force a refresh_token even on re-auth
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${p}`;
}

export interface YouTubeToken {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}

/** Exchange the authorization code for tokens. With prompt=consent a
 * refresh_token is reliably returned; the callback treats its absence as a
 * hard error (the account would be unusable after the access token expires). */
export async function youtubeExchangeCode(
  code: string,
  cfg?: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<YouTubeToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg?.clientId ?? process.env.YOUTUBE_CLIENT_ID!,
      client_secret: cfg?.clientSecret ?? process.env.YOUTUBE_CLIENT_SECRET!,
      redirect_uri: cfg?.redirectUri ?? process.env.YOUTUBE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`YouTube token exchange failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null, expiresIn: body.expires_in ?? 3600 };
}

/** Mint a fresh access token from the stored refresh token. A revoked or
 * expired refresh token (invalid_grant) is permanent — the operator must
 * reconnect. */
export async function youtubeRefreshAccess(
  refreshToken: string,
  cfg?: { clientId: string; clientSecret: string },
): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg?.clientId ?? process.env.YOUTUBE_CLIENT_ID!,
      client_secret: cfg?.clientSecret ?? process.env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    const why = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    if (body.error === "invalid_grant") {
      throw new PermanentError(`YouTube access was revoked — reconnect the account (${why})`);
    }
    if (res.status === 429 || res.status >= 500) throw new Error(`YouTube token refresh failed (retryable): ${why}`);
    throw new PermanentError(`YouTube token refresh failed: ${why}`);
  }
  return { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

export interface YouTubeChannel {
  id: string;
  title: string;
}

/** Resolve the authenticated channel (its id is the account's stable externalId). */
export async function youtubeChannel(accessToken: string): Promise<YouTubeChannel> {
  const res = await fetch(`${API_BASE}/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { title?: string } }>;
    error?: { message?: string };
  };
  const ch = body.items?.[0];
  if (!res.ok || !ch?.id) {
    throw new Error(`YouTube channel lookup failed: ${body.error?.message ?? `HTTP ${res.status}` }`);
  }
  return { id: ch.id, title: ch.snippet?.title ?? "YouTube channel" };
}

/** A YouTube video title can't be empty and can't contain < or >. Derive one
 * from the first line of the caption; the full caption is the description. */
export function youtubeTitleFromCaption(caption: string): string {
  const firstLine = caption.split("\n")[0].trim().replace(/[<>]/g, "");
  return (firstLine || "Untitled").slice(0, YT_TITLE_MAX);
}

export function buildVideoMetadata(caption: string, privacyStatus: "public" | "unlisted" | "private" = "public") {
  return {
    snippet: {
      title: youtubeTitleFromCaption(caption),
      description: caption.slice(0, YT_DESCRIPTION_MAX),
      categoryId: YT_DEFAULT_CATEGORY,
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: false,
    },
  };
}

export function youtubePermalink(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Classify a Data API failure. Retryable: 429, 5xx, and 403 rate-limit
 * reasons. Permanent: 401 (token/scope), 400 (bad metadata), and 403
 * quota/forbidden — retrying every few minutes can't fix a daily quota or a
 * scope problem, and would only burn more quota. */
function classifyYouTubeError(status: number, reason: string, message: string): Error {
  if (status === 429 || status >= 500 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
    return new Error(`YouTube upload failed (retryable): ${message}`);
  }
  if (status === 401) return new PermanentError(`YouTube rejected the credentials — reconnect the account: ${message}`);
  if (reason === "quotaExceeded") {
    return new PermanentError(`YouTube daily upload quota exceeded — try again tomorrow or raise the quota: ${message}`);
  }
  return new PermanentError(`YouTube rejected the upload: ${message}`);
}

interface GoogleError {
  error?: { message?: string; errors?: Array<{ reason?: string }> };
}
function readError(body: GoogleError, status: number): Error {
  const reason = body.error?.errors?.[0]?.reason ?? "";
  return classifyYouTubeError(status, reason, body.error?.message ?? `HTTP ${status}`);
}

/** Upload a video via the resumable protocol: initiate a session with the
 * metadata, then PUT the bytes. Returns the watch URL + video id. Once the PUT
 * returns 200/201 the video exists — nothing throws past that (a retry would
 * create a duplicate). Chunked resume-after-interruption is a documented
 * follow-up; this does a single PUT of the full file. */
export async function publishYouTubeVideo(
  accessToken: string,
  caption: string,
  bytes: Buffer,
  mime: string,
  privacyStatus: "public" | "unlisted" | "private" = "public",
): Promise<PublishResult> {
  // Step 1 — initiate the resumable session.
  const init = await fetch(`${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(bytes.length),
      "X-Upload-Content-Type": mime,
    },
    body: JSON.stringify(buildVideoMetadata(caption, privacyStatus)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!init.ok) {
    throw readError((await init.json().catch(() => ({}))) as GoogleError, init.status);
  }
  const session = init.headers.get("location");
  if (!session) throw new Error("YouTube did not return an upload session URI");

  // Step 2 — upload the bytes to the session URI. Long timeout (under the
  // publish job's stale-claim window) so a large upload isn't reclaimed mid-flight.
  const up = await fetch(session, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime },
    body: bytes as unknown as BodyInit,
    signal: AbortSignal.timeout(9 * 60_000),
  });
  const body = (await up.json().catch(() => ({}))) as { id?: string } & GoogleError;
  if (up.status !== 200 && up.status !== 201) throw readError(body, up.status);
  if (!body.id) throw new Error("YouTube upload returned no video id");
  // LIVE from here — no throwing past this point.
  return { permalink: youtubePermalink(body.id), externalMediaId: body.id };
}
