/* Unit tests for the pure server logic: timezone conversion (DST-correct),
 * vault crypto (round-trip + tamper detection), retry backoff, rules config.
 * Run: npm test */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.VAULT_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

const { zonedTimeToUtc, ianaZone } = await import("../src/lib/server/timezone");
const { encrypt, decrypt } = await import("../src/lib/server/vault");
const { backoffMs } = await import("../src/lib/server/worker");
const { PLATFORM_RULES, COMPOSER_PLATFORMS } = await import("../src/lib/platforms");

test("timezone: ET summer (EDT, UTC-4)", () => {
  assert.equal(zonedTimeToUtc("2026-07-20", "18:00", "ET (Eastern)").toISOString(), "2026-07-20T22:00:00.000Z");
});

test("timezone: ET winter (EST, UTC-5)", () => {
  assert.equal(zonedTimeToUtc("2026-01-15", "18:00", "ET (Eastern)").toISOString(), "2026-01-15T23:00:00.000Z");
});

test("timezone: UTC passthrough", () => {
  assert.equal(zonedTimeToUtc("2026-07-20", "06:30", "UTC").toISOString(), "2026-07-20T06:30:00.000Z");
});

test("timezone: London summer (BST, UTC+1)", () => {
  assert.equal(zonedTimeToUtc("2026-07-20", "18:00", "GMT (London)").toISOString(), "2026-07-20T17:00:00.000Z");
});

test("timezone: PT (PDT, UTC-7)", () => {
  assert.equal(zonedTimeToUtc("2026-07-20", "18:00", "PT (Pacific)").toISOString(), "2026-07-21T01:00:00.000Z");
});

test("timezone: midnight wall time", () => {
  assert.equal(zonedTimeToUtc("2026-07-20", "00:00", "ET (Eastern)").toISOString(), "2026-07-20T04:00:00.000Z");
});

test("timezone: DST spring-forward gap resolves to a valid instant", () => {
  // 02:30 ET on 2026-03-08 does not exist (clocks jump 02:00→03:00).
  const d = zonedTimeToUtc("2026-03-08", "02:30", "ET (Eastern)");
  assert.ok(!Number.isNaN(d.getTime()));
  const iso = d.toISOString();
  assert.ok(iso === "2026-03-08T06:30:00.000Z" || iso === "2026-03-08T07:30:00.000Z", `unexpected: ${iso}`);
});

test("timezone: unknown label throws", () => {
  assert.throws(() => ianaZone("Mars (Olympus Mons)"));
  assert.throws(() => zonedTimeToUtc("2026-07-20", "18:00", "nope"));
});

test("timezone: malformed date throws", () => {
  assert.throws(() => zonedTimeToUtc("", "18:00", "UTC"));
  assert.throws(() => zonedTimeToUtc("2026-07-20", "", "UTC"));
});

test("timezone: out-of-range components throw (no silent rollover)", () => {
  assert.throws(() => zonedTimeToUtc("2026-07-20", "25:00", "UTC"));
  assert.throws(() => zonedTimeToUtc("2026-07-20", "18:61", "UTC"));
  assert.throws(() => zonedTimeToUtc("2026-13-01", "10:00", "UTC"));
  assert.throws(() => zonedTimeToUtc("2026-07-32", "10:00", "UTC"));
});

test("vault: encrypt/decrypt round-trip", () => {
  const secret = "EAABsbCS…very-secret-page-token";
  assert.equal(decrypt(encrypt(secret)), secret);
});

test("vault: unique ciphertext per call (random IV)", () => {
  assert.notEqual(encrypt("same"), encrypt("same"));
});

test("vault: tampered ciphertext fails auth", () => {
  const blob = Buffer.from(encrypt("token"), "base64");
  blob[blob.length - 1] ^= 0xff;
  assert.throws(() => decrypt(blob.toString("base64")));
});

test("backoff: exponential from 1 minute", () => {
  assert.equal(backoffMs(1), 60_000);
  assert.equal(backoffMs(2), 120_000);
  assert.equal(backoffMs(3), 240_000);
  assert.equal(backoffMs(4), 480_000);
});

test("rules: every composer platform has a complete rules entry", () => {
  for (const id of COMPOSER_PLATFORMS) {
    const r = PLATFORM_RULES[id];
    assert.ok(r, `missing rules for ${id}`);
    assert.ok(r.limit > 0);
    assert.ok(r.name && r.mark && r.best);
  }
  assert.equal(PLATFORM_RULES.x.limit, 280);
  assert.equal(PLATFORM_RULES.instagram.limit, 2200);
});

// ── Memory distillation core (Phase 3) — the honesty filter, pure ──────────
const D = await import("../src/lib/server/memory-distill-core");

function view(id: string, link: { kind: string; ref: string } | null) {
  return {
    id, lane: "episodic", title: `t-${id}`, body: `b-${id}`, status: "active",
    confidence: null, tags: [], reviewedAt: null, createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z", links: link ? [{ id: `l-${id}`, note: null, ...link }] : [], derived: true,
  } as unknown as import("../src/lib/server/memory").MemoryView;
}

test("distill: buildEvidence assigns citation ids and skips items with no provenance", () => {
  const { prompt, map } = D.buildEvidence([
    view("a", { kind: "audit", ref: "evt_a" }),
    view("b", null), // no link → cannot be evidence
    view("c", { kind: "metric", ref: "MetricSnapshot rows" }),
  ]);
  assert.equal(prompt.length, 2, "linkless item is excluded");
  assert.deepEqual(prompt.map((p) => p.eid), ["M1", "M2"]);
  assert.equal(map.get("M1")?.ref, "evt_a");
  assert.equal(map.get("M2")?.kind, "metric");
});

test("distill: validateCandidates keeps only real citations and drops uncited/fabricated", () => {
  const map = new Map<string, D.LinkSpec>([
    ["M1", { kind: "audit", ref: "evt_a" }],
    ["M2", { kind: "metric", ref: "metrics" }],
  ]);
  const out = D.validateCandidates(
    {
      candidates: [
        { title: "Real cited learning", body: "Supported by evidence.", confidence: 0.8, evidence: ["M1", "M2"] },
        { title: "Fabricated-only", body: "Cites nothing real.", confidence: 0.9, evidence: ["M9", "nope"] },
        { title: "Uncited", body: "No citations at all.", confidence: 0.5, evidence: [] },
        { title: "", body: "no title", confidence: 0.5, evidence: ["M1"] },
        { title: "Partial", body: "One real one fake.", confidence: 5, evidence: ["M1", "M9", "M1"] },
      ],
    },
    map,
  );
  assert.equal(out.length, 2, "only fully-cited, titled candidates survive");
  assert.deepEqual(out.map((c) => c.title), ["Real cited learning", "Partial"]);
  // Fabricated ids are stripped; duplicate real ref de-duped.
  assert.deepEqual(out[1].links.map((l) => l.ref), ["evt_a"]);
  // Out-of-range confidence is clamped to [0,1].
  assert.equal(out[1].confidence, 1);
  assert.equal(out[0].confidence, 0.8);
});

test("distill: normalizeTitle collapses case/space/punctuation for dedup", () => {
  assert.equal(D.normalizeTitle("Video at 6 PM!"), D.normalizeTitle("  video at 6 pm  "));
  assert.notEqual(D.normalizeTitle("A"), D.normalizeTitle("B"));
  assert.ok(D.EVIDENCE_MIN >= 1);
});

// ── Bluesky (AT Protocol) — the pure protocol logic ────────────────────────
const BS = await import("../src/lib/server/bluesky");

test("bluesky: link facets use UTF-8 byte offsets and trim trailing punctuation", () => {
  const [f] = BS.buildLinkFacets("see https://qantm.ai now");
  assert.equal(f.features[0].$type, "app.bsky.richtext.facet#link");
  assert.equal(f.features[0].uri, "https://qantm.ai");
  assert.equal(f.index.byteStart, 4);
  assert.equal(f.index.byteEnd, 4 + Buffer.byteLength("https://qantm.ai"));
  // A URL ending a sentence must not swallow the period.
  const [g] = BS.buildLinkFacets("go https://x.com.");
  assert.equal(g.features[0].uri, "https://x.com");
});

test("bluesky: byte offsets account for multi-byte characters before the link", () => {
  // "café " is 5 characters but 6 UTF-8 bytes (é = 2 bytes).
  const [f] = BS.buildLinkFacets("café https://qantm.ai");
  assert.equal(f.index.byteStart, 6);
  assert.equal(f.index.byteEnd, 6 + Buffer.byteLength("https://qantm.ai"));
});

test("bluesky: zero links → no facets; multiple links each faceted", () => {
  assert.deepEqual(BS.buildLinkFacets("just text, no urls"), []);
  assert.equal(BS.buildLinkFacets("a https://one.com b https://two.com").length, 2);
});

test("bluesky: permalink derives from the at:// uri rkey", () => {
  const uri = "at://did:plc:abc123/app.bsky.feed.post/3kxyz";
  assert.equal(BS.blueskyPermalink("alice.bsky.social", uri), "https://bsky.app/profile/alice.bsky.social/post/3kxyz");
  assert.equal(BS.blueskyPermalink("@alice.bsky.social", uri), "https://bsky.app/profile/alice.bsky.social/post/3kxyz");
});

test("bluesky: app-password gate rejects a main password", () => {
  assert.ok(BS.looksLikeAppPassword("abcd-efgh-ijkl-mnop"));
  assert.ok(!BS.looksLikeAppPassword("my-real-password"));
  assert.ok(!BS.looksLikeAppPassword("abcdefghijklmnop"));
});

test("bluesky: post record attaches facets/embed only when present", () => {
  const bare = BS.buildPostRecord("hi", "2026-07-26T00:00:00.000Z", [], null);
  assert.equal(bare.$type, "app.bsky.feed.post");
  assert.equal(bare.text, "hi");
  assert.equal(bare.createdAt, "2026-07-26T00:00:00.000Z");
  assert.ok(!("facets" in bare) && !("embed" in bare));
  const rich = BS.buildPostRecord("x", "t", [{ index: { byteStart: 0, byteEnd: 1 }, features: [] }], {
    $type: "app.bsky.embed.images",
    images: [],
  });
  assert.ok("facets" in rich && "embed" in rich);
});

// ── YouTube (Data API v3) — the pure OAuth/metadata logic ──────────────────
const YT = await import("../src/lib/server/youtube");

test("youtube: title derives from the caption's first line, clamped, <> stripped", () => {
  assert.equal(YT.youtubeTitleFromCaption("My great video\nmore text"), "My great video");
  assert.equal(YT.youtubeTitleFromCaption("a <script> b"), "a script b");
  assert.equal(YT.youtubeTitleFromCaption("   "), "Untitled");
  assert.equal(YT.youtubeTitleFromCaption("x".repeat(200)).length, YT.YT_TITLE_MAX);
});

test("youtube: metadata shape + description clamp + privacy default", () => {
  const m = YT.buildVideoMetadata("Title line\nbody");
  assert.equal(m.snippet.title, "Title line");
  assert.equal(m.snippet.description, "Title line\nbody");
  assert.equal(m.snippet.categoryId, YT.YT_DEFAULT_CATEGORY);
  assert.equal(m.status.privacyStatus, "public");
  assert.equal(m.status.selfDeclaredMadeForKids, false);
  assert.equal(YT.buildVideoMetadata("x".repeat(6000)).snippet.description.length, YT.YT_DESCRIPTION_MAX);
  assert.equal(YT.buildVideoMetadata("hi", "unlisted").status.privacyStatus, "unlisted");
});

test("youtube: permalink + auth url carry the offline/consent params", () => {
  assert.equal(YT.youtubePermalink("abc123"), "https://www.youtube.com/watch?v=abc123");
  const saved = { id: process.env.YOUTUBE_CLIENT_ID, sec: process.env.YOUTUBE_CLIENT_SECRET, uri: process.env.YOUTUBE_REDIRECT_URI };
  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_SECRET;
  delete process.env.YOUTUBE_REDIRECT_URI;
  assert.equal(YT.youtubeConfigured(), false);
  process.env.YOUTUBE_CLIENT_ID = "cid";
  process.env.YOUTUBE_CLIENT_SECRET = "csec";
  process.env.YOUTUBE_REDIRECT_URI = "https://app.example/api/oauth/youtube/callback";
  assert.equal(YT.youtubeConfigured(), true);
  const u = new URL(YT.youtubeAuthUrl("st8"));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("state"), "st8");
  assert.match(u.searchParams.get("scope") ?? "", /youtube\.upload/);
  // restore
  if (saved.id) process.env.YOUTUBE_CLIENT_ID = saved.id; else delete process.env.YOUTUBE_CLIENT_ID;
  if (saved.sec) process.env.YOUTUBE_CLIENT_SECRET = saved.sec; else delete process.env.YOUTUBE_CLIENT_SECRET;
  if (saved.uri) process.env.YOUTUBE_REDIRECT_URI = saved.uri; else delete process.env.YOUTUBE_REDIRECT_URI;
});

// ── SSRF address classifier (feed fetcher hardening) ───────────────────────
const { isPrivateAddress } = await import("../src/lib/server/feeds");

test("ssrf: private/loopback/link-local/CGNAT/multicast IPv4 are rejected", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
  }
});

test("ssrf: public IPv4 is allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} must be public`);
  }
});

test("ssrf: IPv6 loopback/ULA/link-local/mapped/multicast are rejected; public v6 allowed", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "ff02::1"]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} must be private`);
  }
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false, "public v6 allowed");
});

test("ssrf: malformed / non-IP fails closed (treated as unsafe)", () => {
  for (const bad of ["not-an-ip", "999.999.999.999", "10.0.0", ""]) {
    assert.equal(isPrivateAddress(bad), true, `${bad} must fail closed`);
  }
});

const { checkConfig } = await import("../src/lib/server/config");
const PROD_BASE = {
  NODE_ENV: "production",
  SESSION_SECRET: "x".repeat(32),
  VAULT_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
  STORAGE_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64"),
  DATABASE_URL: "file:./x",
  PUBLIC_ORIGIN: "https://app.example",
  OAUTH_MOCK: "0",
} as Record<string, string>;

// ── Brand voice (AI-1) — pure fingerprint prompt builder ───────────────────
const BV = await import("../src/lib/server/brand-voice");

test("brand voice: fingerprint prompt embeds the guide + numbered corpus; provisional when empty", () => {
  const p = BV.buildFingerprintPrompt("Tone: warm", ["first post", "second post"]);
  assert.match(p, /Tone: warm/);
  assert.match(p, /\[1\] first post/);
  assert.match(p, /\[2\] second post/);
  const empty = BV.buildFingerprintPrompt("", []);
  assert.match(empty, /No past posts|provisional/i, "empty corpus → provisional, grounded only in the guide");
  assert.equal(BV.FINGERPRINT_SCHEMA.required[0], "fingerprint");
  assert.ok(BV.MIN_CORPUS >= 1);
});

test("config: YouTube OAuth is all-or-none (partial = hard error)", () => {
  const partial = checkConfig({ ...PROD_BASE, YOUTUBE_CLIENT_ID: "cid" });
  assert.ok(partial.errors.some((e) => /YouTube OAuth is partially configured/.test(e)), "partial YOUTUBE_* must error");
  const full = checkConfig({
    ...PROD_BASE,
    YOUTUBE_CLIENT_ID: "cid",
    YOUTUBE_CLIENT_SECRET: "s",
    YOUTUBE_REDIRECT_URI: "https://app.example/api/oauth/youtube/callback",
  });
  assert.ok(!full.errors.some((e) => /YouTube/.test(e)), "complete YOUTUBE_* is not an error");
  assert.ok(!full.warnings.some((w) => /YOUTUBE_\* is unset/.test(w)), "configured → no unset warning");
});

test("config: prod SQLite without DB_BACKUP_CONFIGURED warns (durability nudge)", () => {
  const unacked = checkConfig(PROD_BASE); // DATABASE_URL is file:, DB_BACKUP_CONFIGURED unset
  assert.ok(unacked.warnings.some((w) => /DB_BACKUP_CONFIGURED/.test(w)), "unacknowledged backups must warn");
  const acked = checkConfig({ ...PROD_BASE, DB_BACKUP_CONFIGURED: "1" });
  assert.ok(!acked.warnings.some((w) => /DB_BACKUP_CONFIGURED/.test(w)), "acknowledged → no durability warning");
});
