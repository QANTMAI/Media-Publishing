import { db } from "./db";
import { audit } from "./audit";
import {
  EVIDENCE_REQUIRED_LANES,
  MEMORY_LANES,
  MEMORY_LINK_KINDS,
  MEMORY_STATUSES,
  type MemoryLane,
  type MemoryLinkKind,
  type MemoryStatus,
} from "../taxonomy";

/* Organizational memory ("The Media Channel"). Org-scoped, durable knowledge
 * across the lanes in the taxonomy. Retrieval is SQLite FTS5 (ensureMemoryFts
 * in db.ts). Two invariants enforced here:
 *  - SAFETY: no secrets/credentials ever enter a memory item.
 *  - HONESTY: belief/distillate items must cite real evidence to be `active`. */

export class MemoryError extends Error {}

// ── Safety guard: reject secret-shaped content before it's ever stored. ──
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bmock-token-/i, "looks like a vault token"],
  [/\bBearer\s+[A-Za-z0-9._-]{12,}/i, "looks like a bearer token"],
  [/\b(sk|pk|rk|api|ghp|xox[baprs])[-_][A-Za-z0-9]{16,}/i, "looks like an API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/, "looks like a JWT"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "looks like a private key"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/, "looks like an encoded secret (long base64 blob)"],
];

export function assertMemorySafe(title: string, body: string): void {
  const text = `${title}\n${body}`;
  for (const [re, why] of SECRET_PATTERNS) {
    if (re.test(text)) throw new MemoryError(`Refused: content ${why}. Memory must never store secrets.`);
  }
}

export interface MemoryLinkInput {
  kind: MemoryLinkKind;
  ref: string;
  note?: string;
}

function assertLane(lane: string): asserts lane is MemoryLane {
  if (!(MEMORY_LANES as readonly string[]).includes(lane)) throw new MemoryError(`Unknown lane: ${lane}`);
}
function assertStatus(status: string): asserts status is MemoryStatus {
  if (!(MEMORY_STATUSES as readonly string[]).includes(status)) throw new MemoryError(`Unknown status: ${status}`);
}
function cleanLinks(links: MemoryLinkInput[] = []): MemoryLinkInput[] {
  return links
    .filter((l) => l && l.ref?.trim())
    .map((l) => {
      if (!(MEMORY_LINK_KINDS as readonly string[]).includes(l.kind)) throw new MemoryError(`Unknown link kind: ${l.kind}`);
      return { kind: l.kind, ref: l.ref.trim().slice(0, 500), note: l.note?.trim().slice(0, 300) };
    });
}

export interface CreateMemoryInput {
  lane: string;
  title: string;
  body: string;
  status?: string;
  confidence?: number | null;
  tags?: string[];
  supersedes?: string | null;
  links?: MemoryLinkInput[];
}

/** Create a memory item (+ its evidence links). Enforces safety + the
 * cite-your-evidence rule for claim lanes. */
export async function createMemory(userId: string, input: CreateMemoryInput) {
  assertLane(input.lane);
  const status = input.status ?? "active";
  assertStatus(status);
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (!title || !body) throw new MemoryError("title and body are required");
  assertMemorySafe(title, body);
  const links = cleanLinks(input.links);

  if (status === "active" && EVIDENCE_REQUIRED_LANES.includes(input.lane) && links.length === 0) {
    throw new MemoryError(`A ${input.lane} can't be active without citing evidence — add a source or save as draft.`);
  }

  const item = await db.memoryItem.create({
    data: {
      userId,
      lane: input.lane,
      title: title.slice(0, 300),
      body: body.slice(0, 20_000),
      status,
      confidence: input.confidence ?? null,
      tags: input.tags?.length ? input.tags.map((t) => t.trim()).filter(Boolean).join(",") : null,
      supersedes: input.supersedes ?? null,
      links: links.length ? { create: links } : undefined,
    },
    include: { links: true },
  });
  // A supersede marks the prior item archived (decisions evolve, history kept).
  if (input.supersedes) {
    await db.memoryItem.updateMany({ where: { id: input.supersedes, status: { not: "archived" } }, data: { status: "archived" } });
  }
  await audit("memory.create", { userId, metadata: { id: item.id, lane: item.lane, links: links.length } });
  return item;
}

export interface UpdateMemoryInput {
  title?: string;
  body?: string;
  status?: string;
  confidence?: number | null;
  tags?: string[];
}

export async function updateMemory(userId: string, id: string, patch: UpdateMemoryInput) {
  const existing = await db.memoryItem.findUnique({ where: { id }, include: { links: true } });
  if (!existing) throw new MemoryError("Not found");
  const title = patch.title?.trim() ?? existing.title;
  const body = patch.body?.trim() ?? existing.body;
  assertMemorySafe(title, body);
  const status = patch.status ?? existing.status;
  assertStatus(status);
  if (status === "active" && EVIDENCE_REQUIRED_LANES.includes(existing.lane as MemoryLane) && existing.links.length === 0) {
    throw new MemoryError(`A ${existing.lane} can't be active without citing evidence.`);
  }
  const item = await db.memoryItem.update({
    where: { id },
    data: {
      title: title.slice(0, 300),
      body: body.slice(0, 20_000),
      status,
      confidence: patch.confidence === undefined ? existing.confidence : patch.confidence,
      tags: patch.tags ? patch.tags.map((t) => t.trim()).filter(Boolean).join(",") : existing.tags,
      reviewedAt: new Date(),
    },
    include: { links: true },
  });
  await audit("memory.update", { userId, metadata: { id, status } });
  return item;
}

export async function archiveMemory(userId: string, id: string) {
  const res = await db.memoryItem.updateMany({ where: { id }, data: { status: "archived" } });
  if (res.count === 0) throw new MemoryError("Not found");
  await audit("memory.archive", { userId, metadata: { id } });
}

export async function addMemoryLink(userId: string, memoryItemId: string, link: MemoryLinkInput) {
  const [clean] = cleanLinks([link]);
  if (!clean) throw new MemoryError("link ref required");
  const item = await db.memoryItem.findUnique({ where: { id: memoryItemId } });
  if (!item) throw new MemoryError("Not found");
  await db.memoryLink.create({ data: { memoryItemId, ...clean } });
  await audit("memory.link", { userId, metadata: { memoryItemId, kind: clean.kind } });
}

export interface MemoryView {
  id: string;
  lane: string;
  title: string;
  body: string;
  status: string;
  confidence: number | null;
  tags: string[];
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  links: { id: string; kind: string; ref: string; note: string | null }[];
  /** True for read-only PROJECTIONS over existing stores (episodic/eval) —
   * derived live from the audit log / metrics, not editable or archivable. */
  derived?: boolean;
}

function shape(i: {
  id: string;
  lane: string;
  title: string;
  body: string;
  status: string;
  confidence: number | null;
  tags: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  links: { id: string; kind: string; ref: string; note: string | null }[];
}): MemoryView {
  return {
    id: i.id,
    lane: i.lane,
    title: i.title,
    body: i.body,
    status: i.status,
    confidence: i.confidence,
    tags: i.tags ? i.tags.split(",").filter(Boolean) : [],
    reviewedAt: i.reviewedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    links: i.links,
  };
}

export async function listMemory(opts: { lane?: string; status?: string; limit?: number } = {}): Promise<MemoryView[]> {
  const rows = await db.memoryItem.findMany({
    where: { ...(opts.lane ? { lane: opts.lane } : {}), status: opts.status ?? "active" },
    orderBy: [{ updatedAt: "desc" }],
    take: opts.limit ?? 200,
    include: { links: true },
  });
  return rows.map(shape);
}

export async function getMemory(id: string): Promise<MemoryView | null> {
  const item = await db.memoryItem.findUnique({ where: { id }, include: { links: true } });
  return item ? shape(item) : null;
}

/** Turn free text into a safe FTS5 prefix query (implicit-AND per term). */
function ftsQuery(raw: string): string | null {
  const terms = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1)
    .slice(0, 12)
    .map((t) => `${t}*`);
  return terms.length ? terms.join(" ") : null;
}

/** Full-text recall over active memory (FTS5), newest-relevant first. */
export async function searchMemory(query: string, opts: { lane?: string; limit?: number } = {}): Promise<MemoryView[]> {
  const match = ftsQuery(query);
  if (!match) return [];
  const limit = opts.limit ?? 50;
  const hits = (await db.$queryRawUnsafe(
    `SELECT memoryId FROM MemoryItem_fts WHERE MemoryItem_fts MATCH ? ORDER BY rank LIMIT ?`,
    match,
    limit,
  )) as Array<{ memoryId: string }>;
  const ids = hits.map((h) => h.memoryId);
  if (!ids.length) return [];
  const rows = await db.memoryItem.findMany({
    where: { id: { in: ids }, status: "active", ...(opts.lane ? { lane: opts.lane } : {}) },
    include: { links: true },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.map(shape).sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
}

/** Counts per lane (active) — powers the memory overview. */
export async function memoryLaneCounts(): Promise<Record<string, number>> {
  const rows = await db.memoryItem.groupBy({ by: ["lane"], where: { status: "active" }, _count: true });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.lane] = r._count;
  return out;
}

export interface OnboardingBrief {
  generatedAt: string;
  counts: Record<string, number>;
  beliefs: MemoryView[];
  procedures: MemoryView[];
  concepts: MemoryView[];
  semantic: MemoryView[];
  distillates: MemoryView[];
  recentActivity: MemoryView[]; // episodic projection
  outcomes: MemoryView[]; // eval projection
}

/** Compose the onboarding brief — "what the org knows" — from cited stored
 * memory plus live episodic/eval projections. Template-composed and fully real
 * (no AI in Phase 2); an AI narrative can layer on later, gated on the key. */
export async function buildBrief(): Promise<OnboardingBrief> {
  const { projectEpisodic, projectEval } = await import("./memory-projections");
  const [counts, beliefs, procedures, concepts, semantic, distillates, recentActivity, outcomes] = await Promise.all([
    memoryLaneCounts(),
    listMemory({ lane: "belief" }),
    listMemory({ lane: "procedural" }),
    listMemory({ lane: "concept" }),
    listMemory({ lane: "semantic" }),
    listMemory({ lane: "distillate" }),
    projectEpisodic(12),
    projectEval(),
  ]);
  return {
    // Stamped by the API layer (Date is unavailable in some contexts); default here.
    generatedAt: new Date().toISOString(),
    counts,
    beliefs,
    procedures,
    concepts,
    semantic,
    distillates,
    recentActivity,
    outcomes,
  };
}
