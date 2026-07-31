/* Resolve a feed item's link to a clean, shareable article URL.
 *
 * Normal publisher RSS links are cleaned (tracking params stripped) — reliable.
 * Google News RSS links are opaque redirect tokens ("AU_yqL…") that don't decode
 * to a URL and don't HTTP-redirect to the publisher; the only way to resolve
 * them is Google's UNDOCUMENTED batchexecute RPC. We do that best-effort and
 * fail safe: on ANY error, timeout, or unexpected shape we return null so the
 * caller shows NO link rather than a broken one. Never ships a bad URL.
 *
 * SSRF: the only hosts fetched are the fixed public news.google.com; the
 * resolved URL is returned as a string and never fetched here. */

const TIMEOUT_MS = 12_000;
const UA = { "User-Agent": "Mozilla/5.0 (compatible; QANTMPortal/1.0)" };
const TRACKING = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "oc", "hl", "gl", "ceid", "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src", "guccounter",
]);

// Small process-lifetime cache so repeat drafts of the same item don't re-hit
// Google. Bounded to avoid unbounded growth.
const cache = new Map<string, string | null>();
const CACHE_CAP = 500;

/** Strip tracking params + fragment; return a clean http(s) URL or null. Pure. */
export function cleanUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const k of [...u.searchParams.keys()]) {
    if (TRACKING.has(k) || /^utm_/i.test(k)) u.searchParams.delete(k);
  }
  u.hash = "";
  return u.toString().replace(/\?$/, "").replace(/\/$/, "");
}

export function isGoogleNews(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("news.google.com");
  } catch {
    return false;
  }
}

async function resolveGoogleNews(url: string): Promise<string | null> {
  const id = new URL(url).pathname.split("/articles/")[1]?.split("/")[0];
  if (!id) return null;
  // 1) Fetch the article page for the request-signing params.
  const page = await fetch(`https://news.google.com/rss/articles/${id}`, {
    headers: UA,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!page.ok) return null;
  const html = await page.text();
  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  const aid = html.match(/data-n-a-id="([^"]+)"/)?.[1] ?? id;
  if (!sig || !ts) return null; // page shape changed → give up (fail safe)
  // 2) Ask Google's batchexecute RPC to turn the token into the real URL.
  const payload = `[[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"${aid}\\",${ts},\\"${sig}\\"]",null,"generic"]]]`;
  const be = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", ...UA },
    body: "f.req=" + encodeURIComponent(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!be.ok) return null;
  const txt = await be.text();
  const found = txt.match(/https?:\/\/[^\\"\s]+/)?.[0];
  if (!found || isGoogleNews(found)) return null;
  return cleanUrl(found);
}

/** Resolve a feed item link to a clean article URL, or null if none is usable.
 * Best-effort for Google News (see file header); reliable for normal links. */
export async function resolveArticleUrl(url: string | undefined | null): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;
  let result: string | null;
  try {
    result = isGoogleNews(url) ? await resolveGoogleNews(url) : cleanUrl(url);
  } catch {
    result = null; // fail safe — never a broken link
  }
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(url, result);
  return result;
}
