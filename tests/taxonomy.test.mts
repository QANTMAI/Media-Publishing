/* Taxonomy & legend integrity — asserts the single-source-of-truth registry
 * (src/lib/taxonomy.ts) stays in lockstep with the code that actually uses the
 * vocabularies. Pure unit tests (no server); the point is to FAIL when a new
 * platform, state, audit action, or notify type is added without updating the
 * registry — i.e. to make drift impossible. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const T = await import("../src/lib/taxonomy");
const { PLATFORM_RULES, MARK_TO_PLATFORM, PLATFORM_COLORS, STATUS_COLORS } = await import("../src/lib/platforms");
const { NOTIFY_TYPES } = await import("../src/lib/server/notifications");

// ── Platforms ──
test("taxonomy: PLATFORMS covers exactly the 10 modeled platforms, marks unique", () => {
  assert.equal(T.PLATFORMS.length, 10);
  assert.equal(new Set(T.PLATFORM_IDS).size, 10);
  assert.equal(new Set(T.PLATFORM_MARKS).size, 10);
  // Every platform has a color from PLATFORM_COLORS.
  for (const p of T.PLATFORMS) assert.equal(p.color, PLATFORM_COLORS[p.mark], `${p.id} color`);
});

test("taxonomy: publishable set == platforms with rules AND a mark mapping", () => {
  const fromRegistry = [...T.PUBLISHABLE_PLATFORM_IDS].sort();
  const fromRules = Object.keys(PLATFORM_RULES).sort();
  assert.deepEqual(fromRegistry, fromRules, "publishable must equal PLATFORM_RULES keys");
  // And each publishable id has a mark→id round-trip.
  for (const id of T.PUBLISHABLE_PLATFORM_IDS) {
    const p = T.platformById(id)!;
    assert.equal(MARK_TO_PLATFORM[p.mark], id, `${id} mark round-trip`);
  }
  // Non-publishable platforms must NOT be schedulable (no rules entry).
  for (const p of T.PLATFORMS.filter((x) => !x.publishable)) {
    assert.ok(!(p.id in PLATFORM_RULES), `${p.id} must have no rules`);
  }
});

// ── Provenance ──
test("taxonomy: provenance vocab + helpers", () => {
  assert.deepEqual([...T.ACCOUNT_PROVENANCE], ["real", "mock", "demo"]);
  assert.equal(T.isRealProvenance("real"), true);
  for (const p of ["mock", "demo", null, undefined, "anything"]) assert.equal(T.isRealProvenance(p as string), false);
  assert.equal(T.provenanceTag("real"), "");
  assert.equal(T.provenanceTag("mock"), "mock");
  assert.equal(T.provenanceTag("demo"), "demo");
  // Legacy label backfill map only marks the KNOWN non-real markers.
  assert.equal(T.LEGACY_LABEL_PROVENANCE["mock connection"], "mock");
  assert.equal(T.LEGACY_LABEL_PROVENANCE["demo"], "demo");
  assert.equal(T.LEGACY_LABEL_PROVENANCE["My personal account"], undefined, "a user label is NOT provenance");
});

// ── States ──
test("taxonomy: target-state machine has all six, colors cover them, cancelled included", () => {
  assert.deepEqual([...T.TARGET_STATES], ["draft", "scheduled", "publishing", "published", "failed", "cancelled"]);
  for (const s of T.TARGET_STATES) assert.ok(STATUS_COLORS[s], `color for ${s}`); // the closed drift
  assert.equal(T.TARGET_STATE_COLORS, STATUS_COLORS);
  assert.ok(T.isTerminalState("cancelled") && T.isTerminalState("published") && T.isTerminalState("failed"));
  assert.ok(!T.isTerminalState("scheduled") && !T.isTerminalState("publishing"));
  // Post statuses are the 4-value aggregate (distinct vocab).
  assert.deepEqual([...T.POST_STATUSES], ["draft", "scheduled", "published", "failed"]);
});

// ── Notifications ──
test("taxonomy: NOTIFY_TYPE_KEYS matches the server notification registry", () => {
  assert.deepEqual([...T.NOTIFY_TYPE_KEYS].sort(), Object.keys(NOTIFY_TYPES).sort());
  // Every registered type's level is a known level.
  for (const t of Object.values(NOTIFY_TYPES)) assert.ok((T.NOTIFY_LEVELS as readonly string[]).includes(t.level));
});

// ── Audit action legend — the anti-drift centerpiece ──
function srcFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, acc);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

test("taxonomy: every audit() action emitted in src is in the registry (no drift)", () => {
  const files = srcFiles(join(process.cwd(), "src"));
  const emitted = new Set<string>();
  const re = /audit\(\s*["']([a-z_.]+)["']/g;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(re)) emitted.add(m[1]);
  }
  assert.ok(emitted.size >= 40, `expected many audit actions, found ${emitted.size}`);
  const unregistered = [...emitted].filter((a) => !T.isKnownAuditAction(a));
  assert.deepEqual(unregistered, [], `unregistered audit actions — add them to taxonomy AUDIT_ACTIONS: ${unregistered.join(", ")}`);
  // Registry has no duplicates.
  assert.equal(T.ALL_AUDIT_ACTIONS.length, new Set(T.ALL_AUDIT_ACTIONS).size, "duplicate audit action in registry");
});
