/* Meta Graph API integration (Build Plan §05): Instagram + Facebook (+ Threads)
 * share one Meta developer app. OAuth code flow → long-lived user token →
 * page tokens + linked IG business accounts. All tokens go to the vault.
 *
 * Mock mode: with no META_APP_ID (or OAUTH_MOCK=1) the connect flow simulates
 * a successful grant so the whole pipeline is exercisable before app review
 * completes. Mock accounts are clearly labeled. */

const GRAPH = "https://graph.facebook.com/v21.0";

export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

export function metaConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function mockMode(): boolean {
  return process.env.OAUTH_MOCK === "1" || !metaConfigured();
}

export function metaAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: process.env.META_REDIRECT_URI!,
    scope: META_SCOPES,
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${GRAPH}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    // Never log tokens — strip query params from the reported URL.
    throw new Error(`Graph API ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** code → short-lived token → long-lived token (~60 days). */
export async function exchangeCode(code: string): Promise<{ token: string; expiresIn: number }> {
  const shortTok = await graphGet<{ access_token: string }>("/oauth/access_token", {
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: process.env.META_REDIRECT_URI!,
    code,
  });
  const longTok = await graphGet<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: shortTok.access_token,
  });
  return { token: longTok.access_token, expiresIn: longTok.expires_in ?? 60 * 60 * 24 * 60 };
}

export interface DiscoveredAccount {
  platform: "facebook" | "instagram";
  externalId: string;
  handle: string;
  pageToken: string; // page access token (FB) or the page token used for its IG account
}

/** List the user's Pages and any linked Instagram Business accounts. */
export async function discoverAccounts(userToken: string): Promise<DiscoveredAccount[]> {
  const pages = await graphGet<{
    data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }>;
  }>("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account",
    access_token: userToken,
  });

  const out: DiscoveredAccount[] = [];
  for (const page of pages.data) {
    out.push({ platform: "facebook", externalId: page.id, handle: page.name, pageToken: page.access_token });
    if (page.instagram_business_account) {
      const ig = await graphGet<{ username?: string }>(`/${page.instagram_business_account.id}`, {
        fields: "username",
        access_token: page.access_token,
      });
      out.push({
        platform: "instagram",
        externalId: page.instagram_business_account.id,
        handle: ig.username ? `@${ig.username}` : page.name,
        pageToken: page.access_token,
      });
    }
  }
  return out;
}

/** Cut access on the platform side too (called on disconnect). */
export async function revokeMetaToken(token: string): Promise<void> {
  await fetch(`${GRAPH}/me/permissions?${new URLSearchParams({ access_token: token })}`, {
    method: "DELETE",
  });
}
