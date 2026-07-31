/* Per-platform OAuth APP credentials, entered in-app and stored ENCRYPTED in the
 * same vault as other keys — so an operator can set up Meta / LinkedIn / YouTube
 * without editing .env. Resolution prefers env (deploy-level config) then the
 * vault. The redirect URI is derived from the request origin, so the operator
 * only supplies a Client ID + Secret. The setup GUIDE below encodes each
 * platform's console, scopes, and steps. */

import { getCredentialPlaintext, setCredential, deleteCredential } from "./credentials";

export const OAUTH_PLATFORMS = ["meta", "linkedin", "youtube"] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(p);
}

export interface OAuthCreds {
  clientId: string;
  clientSecret: string;
}

/** Encoded setup knowledge shown in the in-app setup dialog. */
export const OAUTH_GUIDE: Record<OAuthPlatform, { name: string; console: string; steps: string[]; note?: string }> = {
  meta: {
    name: "Instagram + Facebook (Meta)",
    console: "https://developers.facebook.com/apps",
    steps: [
      "Create an app (type: Business) at the Meta developer console.",
      "Add the Facebook Login product; under its settings, add the redirect URI shown below.",
      "Copy the App ID and App Secret (Settings → Basic) into the fields below.",
      "Instagram publishing also needs an IG Business account linked to a Facebook Page, plus App Review for the publishing scopes.",
    ],
    note: "Meta requires an https redirect on a real domain — connect from a deployed (public) URL, not localhost.",
  },
  linkedin: {
    name: "LinkedIn",
    console: "https://www.linkedin.com/developers/apps",
    steps: [
      "Create an app at the LinkedIn developer portal.",
      "Enable the products 'Sign In with LinkedIn using OpenID Connect' and 'Share on LinkedIn' (both self-serve, instant).",
      "Add the redirect URI shown below under Auth → Authorized redirect URLs.",
      "Copy the Client ID and Client Secret into the fields below.",
    ],
    note: "LinkedIn tokens expire in ~60 days; you'll reconnect then.",
  },
  youtube: {
    name: "YouTube (Google)",
    console: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Create a Google Cloud project and configure the OAuth consent screen (External, Testing) — add yourself as a Test user.",
      "Create an OAuth client (type: Web application) and add the redirect URI shown below.",
      "Enable the YouTube Data API v3 for the project.",
      "Copy the Client ID and Client Secret into the fields below.",
    ],
    note: "Until Google's compliance audit, uploads are forced Private and work only for Test users. localhost redirect URIs are allowed for testing.",
  },
};

function envCreds(platform: OAuthPlatform): OAuthCreds | null {
  const map: Record<OAuthPlatform, [string | undefined, string | undefined]> = {
    meta: [process.env.META_APP_ID, process.env.META_APP_SECRET],
    linkedin: [process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET],
    youtube: [process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET],
  };
  const [clientId, clientSecret] = map[platform];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function getStoredOAuth(userId: string, platform: OAuthPlatform): Promise<OAuthCreds | null> {
  const raw = await getCredentialPlaintext(userId, `oauth_${platform}`);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<OAuthCreds>;
    return p.clientId && p.clientSecret ? { clientId: p.clientId, clientSecret: p.clientSecret } : null;
  } catch {
    return null;
  }
}

export async function setStoredOAuth(userId: string, platform: OAuthPlatform, cfg: OAuthCreds): Promise<void> {
  await setCredential(
    userId,
    `oauth_${platform}`,
    JSON.stringify({ clientId: cfg.clientId.trim(), clientSecret: cfg.clientSecret.trim() }),
  );
}

export async function deleteStoredOAuth(userId: string, platform: OAuthPlatform): Promise<boolean> {
  return deleteCredential(userId, `oauth_${platform}`);
}

/** Env config (deploy-level) wins; otherwise the in-app vault config. */
export async function resolveOAuth(userId: string, platform: OAuthPlatform): Promise<OAuthCreds | null> {
  return envCreds(platform) ?? (await getStoredOAuth(userId, platform));
}

export async function oauthConfiguredFor(userId: string, platform: OAuthPlatform): Promise<boolean> {
  return (await resolveOAuth(userId, platform)) !== null;
}

/** The redirect URI the operator registers, derived from the running origin
 * (env override honored). Meta/LinkedIn require https + a real domain. */
export function oauthRedirectUri(origin: string, platform: OAuthPlatform): string {
  const envOverride: Record<OAuthPlatform, string | undefined> = {
    meta: process.env.META_REDIRECT_URI,
    linkedin: process.env.LINKEDIN_REDIRECT_URI,
    youtube: process.env.YOUTUBE_REDIRECT_URI,
  };
  return envOverride[platform] || `${origin.replace(/\/$/, "")}/api/oauth/${platform}/callback`;
}
