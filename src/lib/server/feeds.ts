import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { db } from "./db";

/* Trending & breaking = the operator's own RSS/Atom feeds, polled server-side.
 * No third-party keys, no cost. Only public feed URLs the operator adds. */

const MAX_BYTES = 2_000_000; // cap a feed response — no unbounded downloads
const FETCH_TIMEOUT_MS = 10_000;
const ITEMS_PER_SOURCE = 40; // keep the most recent N per source

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

export interface ParsedItem {
  guid: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

export class FeedError extends Error {}

/* ── SSRF hardening ──────────────────────────────────────────────────────────
 * The earlier guard only inspected the hostname STRING, which three ways bypass:
 * (1) a public host that redirects to an internal IP (redirect:"follow" wasn't
 * re-validated); (2) DNS rebinding — a public name with a private A record;
 * (3) alternate encodings / IPv6 the regex missed. This version resolves the
 * host and validates every RESOLVED IP (v4+v6), and drives redirects manually
 * so each hop is re-validated.
 *
 * Residual (documented, not hidden): a full DNS-rebinding TOCTOU still exists —
 * the IP we validate at lookup time can differ from the IP the kernel connects
 * to. Closing that requires pinning the socket to the validated IP, which the
 * fetch() API can't express. For an authenticated, operator-supplied-URL tool
 * this is an accepted residual; revisit if feeds ever accept untrusted input. */

const REDIRECT_HOPS = 5;

/** True if an IPv4/IPv6 literal is loopback, private, link-local, CGNAT,
 * multicast, or otherwise non-global. A malformed/unknown form is treated as
 * unsafe (fail closed). */
export function isPrivateAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ipv4IsPrivate(ip);
  if (fam === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4-mapped
    if (mapped) return ipv4IsPrivate(mapped[1]);
    const head = lower.split(":")[0];
    if (/^f[cd]/.test(head)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(head)) return true; // fe80::/10 link-local
    if (/^ff/.test(head)) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not a recognized IP literal → unsafe here
}

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // fail closed
  const [a, b] = p;
  return (
    a === 0 || // 0.0.0.0/8 "this host"
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    a >= 224 // multicast / reserved
  );
}

/** Resolve a hostname (or validate an IP literal) and reject if it points at a
 * non-global address. Every A/AAAA record is checked, so a name with one
 * private record can't sneak through. */
async function assertPublicHost(host: string): Promise<void> {
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new FeedError("Internal/loopback addresses aren't allowed");
    return;
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new FeedError("Could not resolve that host");
  }
  if (!addrs.length) throw new FeedError("Could not resolve that host");
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) throw new FeedError("That host resolves to an internal address");
  }
}

/** Validate protocol + host (with DNS resolution) before a fetch. Async because
 * it resolves DNS; called on the initial URL and on every redirect hop. */
async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FeedError("That doesn't look like a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FeedError("Only http(s) feed URLs are allowed");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (host === "localhost" || host.endsWith(".local")) throw new FeedError("Internal/loopback addresses aren't allowed");
  await assertPublicHost(host);
  return u;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"] ?? "");
  return "";
}

function parseDate(v: unknown): Date | null {
  const s = text(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Atom links can be an array of {@_href,@_rel}; prefer rel="alternate". */
function atomLink(link: unknown): string {
  const arr = Array.isArray(link) ? link : [link];
  const alt = arr.find((l) => l && typeof l === "object" && (l as Record<string, unknown>)["@_rel"] === "alternate");
  const pick = (alt ?? arr[0]) as Record<string, unknown> | string | undefined;
  if (typeof pick === "string") return pick;
  return typeof pick === "object" && pick ? String(pick["@_href"] ?? "") : "";
}

/** Parse an RSS 2.0 or Atom document into a normalized feed. */
export function parseFeed(xml: string): ParsedFeed {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new FeedError("Could not parse that feed (invalid XML)");
  }

  // RSS 2.0: <rss><channel><item>…
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss?.channel) {
    const channel = rss.channel as Record<string, unknown>;
    const rawItems = channel.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
    const items = (rawItems as Record<string, unknown>[]).map((it): ParsedItem => {
      const link = text(it.link);
      const guid = text(it.guid) || link;
      const summary = text(it.description) || text(it["content:encoded"]);
      return {
        guid,
        title: stripHtml(text(it.title)) || "(untitled)",
        link,
        summary: summary ? stripHtml(summary).slice(0, 300) : null,
        publishedAt: parseDate(it.pubDate) ?? parseDate(it["dc:date"]),
      };
    });
    return { title: stripHtml(text(channel.title)) || "RSS feed", items };
  }

  // Atom: <feed><entry>…
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const rawEntries = feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
    const items = (rawEntries as Record<string, unknown>[]).map((en): ParsedItem => {
      const link = atomLink(en.link);
      const guid = text(en.id) || link;
      const summary = text(en.summary) || text(en.content);
      return {
        guid,
        title: stripHtml(text(en.title)) || "(untitled)",
        link,
        summary: summary ? stripHtml(summary).slice(0, 300) : null,
        publishedAt: parseDate(en.published) ?? parseDate(en.updated),
      };
    });
    return { title: stripHtml(text(feed.title)) || "Atom feed", items };
  }

  throw new FeedError("That URL isn't an RSS or Atom feed");
}

/** Fetch + parse a feed URL, bounded in time and size. Redirects are followed
 * MANUALLY so every hop is re-validated (a public URL can't redirect us onto an
 * internal address — the classic SSRF-via-redirect). */
export async function fetchFeed(url: string): Promise<ParsedFeed> {
  let current = url;
  let res: Response | null = null;
  for (let hop = 0; hop <= REDIRECT_HOPS; hop++) {
    const u = await assertSafeUrl(current); // protocol + DNS-resolved IP validation, each hop
    let r: Response;
    try {
      r = await fetch(u, {
        redirect: "manual", // we re-validate each hop ourselves
        headers: { "User-Agent": "QANTM-Media-Portal/1.0 (+feed reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FeedError(err instanceof Error && err.name === "TimeoutError" ? "Feed timed out" : "Could not reach that URL");
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new FeedError("Feed redirect had no destination");
      current = new URL(loc, u).toString(); // resolve relative; re-validated next iteration
      continue;
    }
    res = r;
    break;
  }
  if (!res) throw new FeedError("Feed redirected too many times");
  if (!res.ok) throw new FeedError(`Feed responded ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new FeedError("Feed is too large");
  const xml = new TextDecoder("utf-8").decode(buf);
  const parsed = parseFeed(xml);
  if (!parsed.items.length) throw new FeedError("Feed has no items");
  return parsed;
}

export interface SourceView {
  id: string;
  url: string;
  title: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  itemCount: number;
}

export interface ItemView {
  id: string;
  sourceId: string;
  sourceTitle: string;
  title: string;
  link: string;
  summary: string | null;
  publishedAt: string | null;
}

export async function listSources(userId: string): Promise<SourceView[]> {
  const rows = await db.feedSource.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return rows.map((s) => ({
    id: s.id,
    url: s.url,
    title: s.title,
    enabled: s.enabled,
    lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
    lastError: s.lastError,
    itemCount: s._count.items,
  }));
}

/** Recent items across the operator's ENABLED sources, newest first. */
export async function listItems(userId: string, limit = 30): Promise<ItemView[]> {
  const rows = await db.feedItem.findMany({
    where: { source: { userId, enabled: true } },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: limit,
    include: { source: { select: { title: true } } },
  });
  return rows.map((i) => ({
    id: i.id,
    sourceId: i.sourceId,
    sourceTitle: i.source.title,
    title: i.title,
    link: i.link,
    summary: i.summary,
    publishedAt: i.publishedAt?.toISOString() ?? null,
  }));
}

/** Add a source: validate + fetch once so we capture its real title and reject
 * dead/invalid URLs up front. */
export async function addSource(userId: string, url: string): Promise<SourceView> {
  const clean = url.trim();
  const existing = await db.feedSource.findFirst({ where: { userId, url: clean } });
  if (existing) throw new FeedError("That feed is already added");
  const parsed = await fetchFeed(clean); // throws FeedError on any problem
  const source = await db.feedSource.create({ data: { userId, url: clean, title: parsed.title.slice(0, 200) } });
  await saveItems(source.id, parsed.items);
  await db.feedSource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastError: null } });
  const [view] = await listSources(userId).then((all) => all.filter((s) => s.id === source.id));
  return view;
}

async function saveItems(sourceId: string, items: ParsedItem[]): Promise<number> {
  let added = 0;
  for (const it of items.slice(0, ITEMS_PER_SOURCE)) {
    if (!it.link && !it.guid) continue;
    const created = await db.feedItem
      .upsert({
        where: { sourceId_guid: { sourceId, guid: it.guid } },
        create: { sourceId, guid: it.guid, title: it.title.slice(0, 300), link: it.link, summary: it.summary, publishedAt: it.publishedAt },
        update: {}, // items are immutable once seen
      })
      .catch(() => null);
    if (created) added += 1;
  }
  // Prune to the most recent window so the table can't grow unbounded.
  const keep = await db.feedItem.findMany({
    where: { sourceId },
    orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    take: ITEMS_PER_SOURCE,
    select: { id: true },
  });
  await db.feedItem.deleteMany({ where: { sourceId, id: { notIn: keep.map((k) => k.id) } } });
  return added;
}

/** Poll one source, recording success/failure on the row. Never throws. */
export async function pollSource(sourceId: string): Promise<{ ok: boolean; error?: string }> {
  const source = await db.feedSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ok: false, error: "gone" };
  try {
    const parsed = await fetchFeed(source.url);
    await saveItems(source.id, parsed.items);
    await db.feedSource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastError: null } });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "poll failed";
    await db.feedSource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date(), lastError: msg } });
    return { ok: false, error: msg };
  }
}

/** Poll every enabled source for one operator (manual refresh) or all (worker). */
export async function pollFeeds(opts: { userId?: string } = {}): Promise<{ polled: number }> {
  const sources = await db.feedSource.findMany({ where: { enabled: true, ...(opts.userId ? { userId: opts.userId } : {}) }, select: { id: true } });
  for (const s of sources) await pollSource(s.id);
  return { polled: sources.length };
}
