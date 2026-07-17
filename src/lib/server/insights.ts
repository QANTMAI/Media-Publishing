/* Post-metrics collector (T-303) — researched July 2026 against Meta's
 * current docs (Graph API v25.0). Metric names matter: Meta killed
 * `impressions`/`plays`/`video_views` (Apr 2025), `post_impressions`
 * (Nov 2025), and the `*_unique` reach family (Jun 2026). Living metrics:
 *  - IG media:  views, reach, likes, comments, saved, shares
 *               (valid for both FEED and REELS; feed-only extras like
 *               profile_visits are deliberately not requested)
 *  - FB post:   post_media_view (views), post_total_media_view_unique
 *               (reach), post_reactions_by_type_total; comments/shares via
 *               the fields endpoint (?fields=shares,comments.summary(true))
 * Sources: developers.facebook.com IG media-insights + insights references,
 * graph-api/reference/insights, 2025-08-15 Page Insights blog, changelog.
 *
 * Honesty invariant: snapshots are written ONLY from real platform
 * responses. Mock publishes (externalMediaId "mock_…") are skipped — the
 * analytics screens render nothing for them, never fabricated numbers. */

import { db } from "./db";
import { readSecret } from "./vault";
import { audit } from "./audit";

const GRAPH = "https://graph.facebook.com/v25.0";

export const IG_METRICS = ["views", "reach", "likes", "comments", "saved", "shares"] as const;
export const IG_METRICS_CORE = ["views", "reach", "likes", "comments"] as const; // fallback on error 100
export const FB_INSIGHT_METRICS = [
  "post_media_view",
  "post_total_media_view_unique",
  "post_reactions_by_type_total",
] as const;

/** Meta rate-limit error codes (researched): stop the cycle, retry next run. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80001, 80002]);

export class RateLimitedError extends Error {}

export interface ParsedMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

interface InsightsResponse {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number | Record<string, number> }>;
    total_value?: { value?: number };
  }>;
  error?: { message?: string; code?: number };
}

function metricValue(data: InsightsResponse["data"], name: string): number | null {
  const row = data?.find((d) => d.name === name);
  if (!row) return null;
  const v = row.total_value?.value ?? row.values?.[0]?.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    // Reaction-type maps ({like: 3, love: 1, …}) sum to a single count.
    return Object.values(v).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  }
  return null;
}

/** Parse an IG media insights response (data[].name → values[0].value). */
export function parseIgInsights(body: InsightsResponse): ParsedMetrics {
  return {
    views: metricValue(body.data, "views"),
    reach: metricValue(body.data, "reach"),
    likes: metricValue(body.data, "likes"),
    comments: metricValue(body.data, "comments"),
    shares: metricValue(body.data, "shares"),
    saves: metricValue(body.data, "saved"),
  };
}

/** Parse FB post insights + the fields call (shares struct, comments summary). */
export function parseFbInsights(
  insights: InsightsResponse,
  fields: { shares?: { count?: number }; comments?: { summary?: { total_count?: number } } },
): ParsedMetrics {
  return {
    views: metricValue(insights.data, "post_media_view"),
    reach: metricValue(insights.data, "post_total_media_view_unique"),
    likes: metricValue(insights.data, "post_reactions_by_type_total"),
    comments: fields.comments?.summary?.total_count ?? null,
    shares: fields.shares?.count ?? null,
    saves: null, // Facebook does not report saves
  };
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (body.error && RATE_LIMIT_CODES.has(body.error.code ?? -1)) {
    throw new RateLimitedError(body.error.message ?? "rate limited");
  }
  if (!res.ok || body.error) {
    throw new Error(`Graph ${path}: ${body.error?.message ?? `HTTP ${res.status}`} (code ${body.error?.code ?? "?"})`);
  }
  return body;
}

async function fetchInstagram(mediaId: string, token: string): Promise<{ parsed: ParsedMetrics; raw: unknown }> {
  try {
    const body = await graphGet<InsightsResponse>(`/${mediaId}/insights`, {
      metric: IG_METRICS.join(","),
      access_token: token,
    });
    return { parsed: parseIgInsights(body), raw: body };
  } catch (err) {
    if (err instanceof RateLimitedError) throw err;
    // Error 100 = a requested metric isn't valid for this media type/state —
    // retry once with the core set instead of losing the whole pull.
    if (err instanceof Error && /code 100/.test(err.message)) {
      const body = await graphGet<InsightsResponse>(`/${mediaId}/insights`, {
        metric: IG_METRICS_CORE.join(","),
        access_token: token,
      });
      return { parsed: parseIgInsights(body), raw: body };
    }
    throw err;
  }
}

async function fetchFacebook(postId: string, token: string): Promise<{ parsed: ParsedMetrics; raw: unknown }> {
  const insights = await graphGet<InsightsResponse>(`/${postId}/insights`, {
    metric: FB_INSIGHT_METRICS.join(","),
    access_token: token,
  });
  const fields = await graphGet<{ shares?: { count?: number }; comments?: { summary?: { total_count?: number } } }>(
    `/${postId}`,
    { fields: "shares,comments.summary(true).limit(0)", access_token: token },
  );
  return { parsed: parseFbInsights(insights, fields), raw: { insights, fields } };
}

const COLLECT_WINDOW_DAYS = 90; // metrics freeze after 90 days (decay schedule)
const MIN_SNAPSHOT_GAP_MS = 6 * 60 * 60_000; // at most one pull per post per 6h (IG data lags ≤48h anyway)
const BATCH = 40;

/** One collection cycle: pull real insights for recently-published targets on
 * insight-capable platforms. Rate limiting aborts the cycle cleanly. */
export async function collectMetricsCycle(now = new Date()): Promise<{ pulled: number; skipped: number }> {
  const since = new Date(now.getTime() - COLLECT_WINDOW_DAYS * 24 * 60 * 60_000);
  const candidates = await db.postTarget.findMany({
    where: {
      state: "published",
      externalMediaId: { not: null },
      scheduledAt: { gte: since },
      account: { platform: { in: ["instagram", "facebook"] }, tokenRef: { not: null } },
    },
    include: {
      account: { select: { platform: true, tokenRef: true } },
      metrics: { orderBy: { fetchedAt: "desc" }, take: 1 },
    },
    take: 200,
  });

  let pulled = 0;
  let skipped = 0;
  for (const target of candidates) {
    if (pulled >= BATCH) break;
    // No fabricated numbers, ever: mock publishes have no platform to ask.
    if (!target.externalMediaId || target.externalMediaId.startsWith("mock_")) {
      skipped += 1;
      continue;
    }
    const last = target.metrics[0];
    if (last && now.getTime() - last.fetchedAt.getTime() < MIN_SNAPSHOT_GAP_MS) {
      skipped += 1;
      continue;
    }
    const token = target.account.tokenRef ? await readSecret(target.account.tokenRef) : null;
    if (!token || token.startsWith("mock-token-")) {
      skipped += 1;
      continue;
    }

    try {
      const { parsed, raw } =
        target.account.platform === "instagram"
          ? await fetchInstagram(target.externalMediaId, token)
          : await fetchFacebook(target.externalMediaId, token);
      await db.metricSnapshot.create({
        data: { postTargetId: target.id, ...parsed, raw: JSON.stringify(raw).slice(0, 20_000) },
      });
      pulled += 1;
    } catch (err) {
      if (err instanceof RateLimitedError) {
        // Researched guidance: stop calling when throttled; next cycle retries.
        await audit("metrics.rate_limited", { metadata: { after: pulled } });
        break;
      }
      // One bad post (deleted on-platform, pre-conversion media, <5 viewers)
      // must not kill the cycle — log and move on.
      console.error("insights pull failed", target.id, err instanceof Error ? err.message : err);
      skipped += 1;
    }
  }
  if (pulled > 0) await audit("metrics.collected", { metadata: { pulled, skipped } });
  return { pulled, skipped };
}
