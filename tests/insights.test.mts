/* Unit tests for the insights collector's pure logic. Fixtures follow the
 * response shapes in Meta's v25.0 docs (data[].name/values[0].value, and
 * total_value for breakdown metrics) — researched July 2026. */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STORAGE_SIGNING_KEY = process.env.STORAGE_SIGNING_KEY ?? Buffer.alloc(32, 5).toString("base64");
process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY ?? Buffer.alloc(32, 5).toString("base64");
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

const { parseIgInsights, parseFbInsights, IG_METRICS, FB_INSIGHT_METRICS } = await import(
  "../src/lib/server/insights"
);

test("IG parser: doc-shaped media insights response", () => {
  const parsed = parseIgInsights({
    data: [
      { name: "views", values: [{ value: 1543 }] },
      { name: "reach", values: [{ value: 1201 }] },
      { name: "likes", values: [{ value: 87 }] },
      { name: "comments", values: [{ value: 12 }] },
      { name: "saved", values: [{ value: 9 }] },
      { name: "shares", values: [{ value: 5 }] },
    ],
  });
  assert.deepEqual(parsed, { views: 1543, reach: 1201, likes: 87, comments: 12, shares: 5, saves: 9 });
});

test("IG parser: missing metrics stay null — never invented", () => {
  const parsed = parseIgInsights({ data: [{ name: "views", values: [{ value: 10 }] }] });
  assert.equal(parsed.views, 10);
  assert.equal(parsed.reach, null);
  assert.equal(parsed.likes, null);
  assert.equal(parsed.saves, null);
});

test("IG parser: total_value form (breakdown metrics) is read", () => {
  const parsed = parseIgInsights({
    data: [{ name: "views", values: [], total_value: { value: 42 } }],
  });
  assert.equal(parsed.views, 42);
});

test("FB parser: media_view metrics + reaction map + fields call", () => {
  const parsed = parseFbInsights(
    {
      data: [
        { name: "post_media_view", values: [{ value: 900 }] },
        { name: "post_total_media_view_unique", values: [{ value: 640 }] },
        // reactions arrive as a per-type map — summed to one count
        { name: "post_reactions_by_type_total", values: [{ value: { like: 30, love: 4, wow: 1 } }] },
      ],
    },
    { shares: { count: 7 }, comments: { summary: { total_count: 15 } } },
  );
  assert.deepEqual(parsed, { views: 900, reach: 640, likes: 35, comments: 15, shares: 7, saves: null });
});

test("metric config avoids every deprecated Meta metric name", () => {
  // Apr 2025 / Nov 2025 / Jun 2026 deprecation waves — requesting these errors.
  const dead = [
    "impressions",
    "plays",
    "video_views",
    "post_impressions",
    "post_impressions_unique",
    "post_impressions_organic",
    "post_impressions_paid_unique",
  ];
  const requested = [...IG_METRICS, ...FB_INSIGHT_METRICS] as string[];
  for (const d of dead) {
    assert.ok(!requested.includes(d), `deprecated metric "${d}" must not be requested`);
  }
  // The living replacements are what we ask for.
  assert.ok(requested.includes("views"));
  assert.ok(requested.includes("post_media_view"));
  assert.ok(requested.includes("post_total_media_view_unique"));
});
