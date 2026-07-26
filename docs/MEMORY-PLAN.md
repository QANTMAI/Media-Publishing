# Memory — "The Media Channel" (PROPOSAL — not yet implemented)

> Status: **plan only.** Nothing in this document is built. It is the audit +
> design for turning the portal into a durable organizational memory — the
> social-media *brain*, not a tool that queries one. It reuses what exists
> (per the standing "don't rebuild, extend" rule) and names every conflict
> before any code is written.

## 0. Goal, in one line

Six durable memory lanes that persist across sessions, deployments, and
**personnel changes** — so when someone leaves the decisions stay, and when
someone joins the system onboards them from cited, real knowledge (never
fabricated).

## 1. Inventory — what we already have (ground truth, verified)

| Store | Rows now | Character | Which lane it seeds |
|---|---|---|---|
| `AuditEvent` | **2,345** | Append-only action log (`action`, `userId`, `metadata` JSON, `createdAt`; no secrets) | **Episodic** |
| `Post` / `PostTarget` | 0 now (purged) | What we published, when, where, outcome, permalink | **Episodic** + **Eval** |
| `MetricSnapshot` | 0 (until real connections) | Append-only performance time series, real-response-only | **Eval** |
| `taxonomy.ts` + `Category` (6) | — / 6 | Controlled vocabularies, the legend, content categories | **Semantic** + **Concept** |
| `PLATFORM_RULES` / `video-specs` | — | Enforced platform facts | **Semantic** |
| `FeedSource` / `FeedItem` | 0 | External signal (trends) | **Episodic** (external) |
| `Notification` | 0 | Event surfacing | **Episodic** |
| docs/ + code comments + hardened rules | — | Policies, workflows, rationale | **Belief** + **Procedural** (but *not* retrievable) |

**Retrieval engine available:** SQLite **FTS5** is compiled in and working
(verified) — native full-text search, zero dependencies, no external provider.
This is how memory becomes *recallable* without embeddings (which would need a
non-Anthropic provider — see Conflict C2).

**Two memories that must never be conflated (Conflict C5):**
- *Agent memory* (`.claude/.../memory/*.md`) — Claude's cross-session context.
  Private to the assistant. NOT the product.
- *Organizational memory* (this proposal) — the org's knowledge, in the app DB,
  for human + AI users. Survives operator changes. This is what we're building.

## 2. The six lanes — definition, source, honesty rule

| Lane | Holds | Seeded from | Authored | Honesty gate |
|---|---|---|---|---|
| **Episodic** | "What happened, when" — events & experiences | AuditEvent, Post/Target, Notifications, FeedItems | Auto (derived) | Immutable facts; timestamped |
| **Semantic** | "What is true" — facts, vocabularies, entities | taxonomy, Category, PLATFORM_RULES, account facts | Auto + manual | Single-source (taxonomy owns it) |
| **Concept** | Named ideas — content pillars, campaigns, audiences | Category + new operator entries | Manual | Defined, not inferred |
| **Procedural** | "How we do it" — playbooks, workflows, checklists | docs + new operator entries | Manual | Versioned; steps are testable |
| **Belief** | Stances/policies — brand voice, banned words, guardrails, the hardened rules | new operator entries (some from existing rules) | Manual | Explicit owner + rationale |
| **Eval** | "How good was it" — outcomes, scores, judgments | MetricSnapshot, publish success/fail | Auto + manual | Real metrics only; no fabricated numbers |
| **Distillate** | Compressed learnings — "we learned X" | AI synthesis over Episodic + Eval | AI-proposed, **human-approved** | **MUST cite its evidence**; unverified → not promoted |

## 3. Design — extend, don't replace

One new curation layer over the existing substrate:

```
MemoryItem
  id, lane (episodic|semantic|concept|procedural|belief|eval|distillate)
  title, body                     -- the knowledge
  status (draft|active|archived)  -- lifecycle; nothing hard-deleted
  confidence (0..1)               -- for distillate/belief
  authoredBy (userId, nullable)   -- who, so it survives them leaving
  reviewedAt, reviewedBy          -- freshness / stewardship
  supersedes (MemoryItemId?)      -- decisions evolve, history kept
  createdAt, updatedAt
MemoryLink                        -- PROVENANCE: every distillate/belief cites evidence
  memoryItemId -> (auditEventId | metricSnapshotId | postId | memoryItemId | url)
MemoryItem_fts (FTS5)             -- title+body full-text index for recall
MemoryTag                        -- cross-lane linking (platform, category, campaign)
```

- **Episodic/Eval are projections**, not copies: derived views over
  AuditEvent/MetricSnapshot, so we don't duplicate the 2,345-event log.
- **Provenance is mandatory** for Distillate & Belief (extends the honesty rule
  and the new `provenance` field philosophy): a claim with no `MemoryLink` to
  real evidence cannot be `active`.
- **Nothing is deleted** — `status=archived` + `supersedes` keep the decision
  trail (mirrors the cancel-is-a-state, category-by-name rules).

## 4. Retrieval & onboarding

- **Recall:** FTS5 over `MemoryItem_fts`, filtered by lane/tag. Real, instant, free.
- **"What do we know about X":** ranked MemoryItems + their cited evidence.
- **Onboarding brief:** a generated digest per lane (active Beliefs, key
  Concepts, top Procedures, recent Distillates) — **template-composed from
  cited memory first**; AI-summarized only when the Anthropic key is present,
  with an honest "key not set" fallback. Never invents knowledge.

## 5. Conflicts & issues (surface before building)

- **C1 — Multi-user vs single-operator (BLOCKER for the "personnel" promise).**
  The vision says "when a user leaves / a new hire joins." The app is
  **single-operator** by design (one `User`, mandatory TOTP, no roles/teams).
  Memory *content* can be org-scoped and survive an operator swap today, but
  true "user leaves / new hire onboarded with their own login" needs a
  multi-user/RBAC model the current auth does not have. **Decision needed.**
- **C2 — Retrieval: FTS5 vs embeddings.** FTS5 (recommended) is real, free, no
  new dep, no external provider. Embeddings would need a non-Anthropic provider
  → conflicts with the no-OpenAI rule and adds cost/deps. Recommend FTS5 now;
  revisit embeddings only if semantic recall proves insufficient.
- **C3 — Distillate needs AI (sequencing).** Auto-distillation depends on the
  AI studio (T-304, not built) + the operator's Anthropic key. So the memory
  *substrate* (lanes 1–6, manual + derived) ships first with zero AI; the
  Distillate lane's *automation* is a later phase, gated + honest when no key.
- **C4 — AuditEvent is a security log, not curated memory.** Reading it as
  Episodic is fine; promoting raw log lines into "knowledge" is not. Memory
  items are curated/derived with intent, and the log keeps growing (no prune
  today — acceptable for a log, but memory needs stewardship/review dates).
- **C5 — Agent vs org memory** (see §1) — never merge them.
- **C6 — Honesty/no-fakes extends to memory.** A Distillate ("video at 6pm
  performs best") is only `active` if it links to the MetricSnapshots that
  support it. No uncited insights, ever.

## 6. Health & safety (always on)

- **No secrets, no audience PII** in any MemoryItem (same rule as AuditEvent
  metadata). A write-time guard rejects token-shaped / PII-shaped content.
- **Retention & review:** Beliefs/Procedures carry `reviewedAt`; stale items are
  flagged, not silently trusted. Episodic projections inherit the log's
  retention.
- **Access control:** today, the single operator. If C1 goes multi-user, memory
  reads/writes become role-gated and every write is audited (`memory.*` actions
  added to the taxonomy registry).
- **Durability:** memory lives in the same SQLite + WAL + Litestream path as the
  rest — backed up continuously, survives deployments.

## 7. Phased plan (each phase = its own gate: tests + verify + push)

- **Phase 0 — this document** (audit + plan). ✅
- **Phase 1 — Substrate (no AI): ✅ SHIPPED.** `MemoryItem`/`MemoryLink` +
  FTS5 (created at boot, trigger-synced), the `memory.*` audit actions in the
  registry, `/api/memory` CRUD + `/api/memory/:id/link`, a Memory UI (lane
  overview, FTS search, cited-evidence display, authoring with the honesty
  guard surfaced). Beliefs/Procedures/Semantic seeded from the existing rules
  (cited). Safety guard rejects secret-shaped content; belief/distillate can't
  go active without evidence. Episodic/Eval *projections* over existing stores
  land with Phase 2. 68/68 tests.
- **Phase 2 — Recall & onboarding: ✅ SHIPPED.** Episodic & Eval are live
  PROJECTIONS (memory-projections.ts) — Episodic humanizes the audit log
  (auth noise excluded, each item cites its audit row); Eval computes real
  publish outcomes + metric aggregates, honest-empty when nothing has
  published. Served through `/api/memory?lane=episodic|eval` (appended after
  curated items; derived items are read-only). The onboarding brief
  (`GET /api/memory/brief`, "Onboarding brief" button) is template-composed
  from cited beliefs/procedures/concepts/facts + live activity + outcomes.
  72/72 tests.
- **Phase 3 — Distillate automation: ✅ SHIPPED.** AI-proposed, human-approved,
  evidence-cited learnings over the live Episodic + Eval projections, gated on
  the operator's Anthropic key (bring-your-own, from the vault; never OpenAI).
  `memory-distill-core.ts` is the pure, unit-tested honesty filter: it packages
  each projection item as cited evidence, and `validateCandidates` keeps ONLY
  citations that map to a real row — fabricated ids are dropped, and any
  candidate left uncited is discarded (C6). `memory-distill.ts` reads the key,
  calls the Anthropic Messages API (raw HTTPS, `claude-opus-5`, structured
  JSON output, low effort), and writes each survivor as a `distillate` **draft**
  — never auto-active. The operator approves a draft (draft → active), which
  the evidence-required rule already guards. Honest no-ops throughout: no key,
  too little activity (`< EVIDENCE_MIN`), a provider error, or nothing above
  routine each return a clear reason and write nothing. `POST/GET
  /api/memory/distill` + a "Distill insights" button and per-draft Approve
  control on the Memory page; `memory.distill` in the audit registry. 81 tests.
- **Phase 4 — Multi-user/RBAC:** only if C1 is resolved that direction.

## 8. Decisions needed before Phase 1

1. **Scope of "personnel changes" now** (C1): org-scoped memory with the single
   operator as steward (ship now), or commit to a multi-user/roles model first?
2. **Retrieval** (C2): confirm FTS5 now (recommended), embeddings deferred?
3. **Belief/Procedural seeding:** import the existing hardened rules + DATA-MAP
   workflows as the first Belief/Procedural entries, or start empty and let the
   operator author?
