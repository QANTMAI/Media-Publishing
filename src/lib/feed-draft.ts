/* Builds a clean starting caption from a trending feed item. Pure + testable.
 *
 * Feeds — especially Google News RSS — hand back messy data: titles with a
 * " - Publisher" suffix, "source" names that are really the search query
 * (`"artificial intelligence" when:1d - Google News`), and enormous redirect
 * URLs. The old draft dumped all of it verbatim, garbling the caption and
 * blowing the character limit. This extracts a real headline + publisher and
 * only includes a link when it's a genuinely clean, short article URL. */

export interface FeedDraftInput {
  title: string;
  sourceTitle: string;
  link: string;
  summary?: string | null;
}

/** Split "Headline - Publisher" into parts. The publisher segment is only
 * accepted when it's short and plausibly a name (not a URL or a search query). */
export function splitHeadline(title: string, sourceTitle: string): { headline: string; publisher: string } {
  const t = (title ?? "").trim();
  const parts = t.split(" - ");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (last.length > 0 && last.length <= 40 && !/https?:/i.test(last)) {
      return { headline: parts.slice(0, -1).join(" - ").trim(), publisher: last };
    }
  }
  // Fall back to the feed's source title only if it looks like a clean name —
  // no quotes or search operators like `when:1d`.
  const src = (sourceTitle ?? "").trim();
  const cleanSource = src && /^[\w .,&'’-]+$/.test(src) && !/\b\w+:/.test(src) ? src : "";
  return { headline: t, publisher: cleanSource };
}

/** A clean, short article URL, or null. Drops Google News redirect links
 * (unusable without resolving) and strips tracking query/hash. */
export function cleanLink(link: string | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    if (u.hostname.includes("news.google.com")) return null;
    u.search = "";
    u.hash = "";
    const clean = u.toString().replace(/\/$/, "");
    return clean.length <= 80 ? clean : null;
  } catch {
    return null;
  }
}

/** The clean caption to seed the composer from a trending item. */
export function feedDraftCaption(item: FeedDraftInput): string {
  const { headline, publisher } = splitHeadline(item.title, item.sourceTitle);
  const lead = publisher ? `${headline} — ${publisher}` : headline;
  const link = cleanLink(item.link);
  return link ? `${lead}\n\n${link}` : lead;
}
