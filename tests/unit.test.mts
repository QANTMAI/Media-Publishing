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
