import { db } from "./db";
import { createMemory, type CreateMemoryInput } from "./memory";
import { audit } from "./audit";

/* Seeds the memory lanes from the org's EXISTING, already-true rules and
 * workflows (operator chose "import existing rules/workflows"). Every seeded
 * belief/procedure cites the doc it comes from, so the honesty/evidence rule
 * holds from day one. Idempotent: skips a lane+title that already exists. */

const SEED: CreateMemoryInput[] = [
  // ── Beliefs (stances/policies — the hardened rules) ──
  {
    lane: "belief",
    title: "Honesty: never fabricate metrics or state",
    body: "Show real, DB-derived data or an explicit 'not connected yet / sample' state. Empty is honest; a fabricated number is not.",
    tags: ["honesty", "data"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#7-rules-the-system-follows", note: "Rule 4" }],
  },
  {
    lane: "belief",
    title: "No fakes: provenance is a stored field, mock/demo always labeled",
    body: "An account/post is real, mock, or demo — stored, never inferred. Anything not 'real' is visibly flagged and never reaches a live platform.",
    tags: ["honesty", "provenance"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#provenance--the-honesty-field" }],
  },
  {
    lane: "belief",
    title: "Single source of truth for vocabularies",
    body: "Every controlled value (platform, status, provenance, audit action, notify type) is declared once in src/lib/taxonomy.ts; the anti-drift test enforces it. Never inline a new vocabulary string.",
    tags: ["taxonomy", "engineering"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#1-taxonomy-legend" }, { kind: "doc", ref: "src/lib/taxonomy.ts" }],
  },
  {
    lane: "belief",
    title: "Config, not code, for platform limits",
    body: "Caption/media/video limits live in versioned config and are both displayed and enforced from it. No hand-written numbers in UI or copy.",
    tags: ["platforms", "engineering"],
    links: [{ kind: "doc", ref: "docs/PLATFORM-RULES.md" }],
  },
  {
    lane: "belief",
    title: "Secrets never leave the server",
    body: "Vault plaintext is never returned, logged, or sent to the client; credentials expose only a masked hint. Memory items may never contain secrets (a write-time guard rejects them).",
    tags: ["security"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#7-rules-the-system-follows", note: "Rule 5" }, { kind: "doc", ref: "docs/SECURITY.md" }],
  },
  {
    lane: "belief",
    title: "History is durable — deletes don't cascade history",
    body: "Category is referenced by name (delete-safe); metrics are append-only; cancel is a state, not a delete; memory archives, never hard-deletes.",
    tags: ["data", "durability"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#7-rules-the-system-follows", note: "Rule 6" }],
  },
  {
    lane: "belief",
    title: "AI provider is Anthropic — never OpenAI",
    body: "All AI features use Anthropic (bring-your-own-key, stored in the vault). Do not use, suggest, or add OpenAI.",
    tags: ["ai", "policy"],
    links: [{ kind: "doc", ref: "docs/ARCHITECTURE.md#whats-next", note: "AI studio (BYO Anthropic key)" }],
  },

  // ── Procedures (how we operate) ──
  {
    lane: "procedural",
    title: "Publishing workflow",
    body: "Compose (base caption + per-platform) → schedule to specific accounts → durable queue publishes at time with exponential-backoff retries → failures surface the platform's real error. The kill switch holds the whole queue instantly.",
    tags: ["publishing", "workflow"],
    links: [{ kind: "doc", ref: "docs/ARCHITECTURE.md" }, { kind: "doc", ref: "docs/DATA-MAP.md#4-signal-data-ingestion-paths" }],
  },
  {
    lane: "procedural",
    title: "Connect a platform",
    body: "Accounts → Connect → OAuth on the platform's own page → token encrypted in the vault → SocialAccount row with provenance set. Real when the app's credentials exist, else clearly-labeled mock. Meta + LinkedIn are live.",
    tags: ["accounts", "oauth", "workflow"],
    links: [{ kind: "doc", ref: "docs/ARCHITECTURE.md" }, { kind: "doc", ref: "src/lib/server/linkedin.ts" }],
  },
  {
    lane: "procedural",
    title: "Autopilot review flow",
    body: "Autopilot plans a week; delivery mode routes drafts to the Dashboard review inbox (approve/edit/discard) or straight to the calendar. Turning it off removes unpublished plans.",
    tags: ["autopilot", "workflow"],
    links: [{ kind: "doc", ref: "docs/ARCHITECTURE.md" }],
  },
  {
    lane: "procedural",
    title: "Deployment (SQLite + WAL + Litestream)",
    body: "SQLite in every environment; WAL enabled at boot; Litestream streams continuous backups. A boot config guard aborts a misconfigured production start; /api/health is the readiness probe.",
    tags: ["ops", "deployment"],
    links: [{ kind: "doc", ref: "docs/DEPLOYMENT.md" }],
  },

  // ── Semantic (facts) ──
  {
    lane: "semantic",
    title: "Publishable platforms are the ones with rules",
    body: "The composer can only target a platform that has a PLATFORM_RULES entry + a mark mapping (taxonomy.PUBLISHABLE_PLATFORM_IDS). Others are modeled but not yet integrated and are rejected (422) at scheduling.",
    tags: ["platforms", "taxonomy"],
    links: [{ kind: "doc", ref: "docs/DATA-MAP.md#1-taxonomy-legend" }],
  },
];

/** Seed once for the operator. Idempotent by (lane, title). Returns count added. */
export async function seedMemory(userId: string): Promise<number> {
  let added = 0;
  for (const item of SEED) {
    const exists = await db.memoryItem.findFirst({ where: { lane: item.lane, title: item.title } });
    if (exists) continue;
    await createMemory(userId, item);
    added += 1;
  }
  if (added > 0) await audit("memory.seed", { userId, metadata: { added } });
  return added;
}
