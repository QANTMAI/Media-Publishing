import { XMLParser } from "fast-xml-parser";
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

/** Reject non-http(s) and obviously-internal hosts before fetching a
 * user-supplied URL (basic SSRF hardening for a single-operator tool). */
function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FeedError("That doesn't look like a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FeedError("Only http(s) feed URLs are allowed");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new FeedError("Internal/loopback addresses aren't allowed");
  }
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

/** Fetch + parse a feed URL, bounded in time and size. */
export async function fetchFeed(url: string): Promise<ParsedFeed> {
  assertSafeUrl(url);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "QANTM-Media-Portal/1.0 (+feed reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new FeedError(err instanceof Error && err.name === "TimeoutError" ? "Feed timed out" : "Could not reach that URL");
  }
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
