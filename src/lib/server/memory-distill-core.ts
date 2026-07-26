/* Distillation — the PURE core (no DB, no network, no secrets).
 *
 * Phase 3 of the memory plan (docs/MEMORY-PLAN.md §7): AI-proposed,
 * human-approved, evidence-CITED "we learned X" insights synthesized over the
 * Episodic + Eval projections. This file holds only the deterministic pieces —
 * the evidence packaging, the request schema/prompt, and the honesty filter
 * that turns a raw model response into cited draft candidates. It is unit-
 * tested in isolation (no Prisma, no fetch). The orchestrator that reads the
 * key, calls Anthropic, and writes drafts lives in memory-distill.ts.
 *
 * Honesty invariant (MEMORY-PLAN §6, C6): a distillate is only allowed to cite
 * evidence we actually handed the model. validateCandidates() drops any cited
 * id that isn't in the real evidence map, and drops any candidate left with no
 * real citation — so the model can never manufacture provenance. */

import type { MemoryView } from "./memory";
import type { MemoryLinkKind } from "../taxonomy";

/** Below this many real evidence items we don't even call the model — there's
 * nothing honest to distill yet (honest no-op instead of invented insight). */
export const EVIDENCE_MIN = 3;

/** One provenance link a candidate may cite — always traced back to a real row. */
export interface LinkSpec {
  kind: MemoryLinkKind;
  ref: string;
  note?: string;
}

/** An evidence line as presented to the model (secret-free by construction —
 * audit rows and metric aggregates never contain credentials). */
export interface EvidenceItem {
  eid: string; // stable citation token, e.g. "M1"
  when: string;
  what: string;
}

export interface RawCandidate {
  title?: unknown;
  body?: unknown;
  confidence?: unknown;
  evidence?: unknown;
}
export interface RawDistillResponse {
  candidates?: RawCandidate[];
}

/** A validated, fully-cited draft ready to be written as a `distillate` draft. */
export interface DraftCandidate {
  title: string;
  body: string;
  confidence: number;
  links: LinkSpec[];
}

/** Structured-output schema (Anthropic `output_config.format`). Constraint-free
 * per the structured-outputs rules (no min/max/length) — we clamp client-side. */
export const DISTILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body", "confidence", "evidence"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          confidence: { type: "number" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const SYSTEM_PROMPT = [
  "You analyze a single organization's REAL social-publishing activity and outcomes to propose durable learnings — compressed 'we learned X' insights that would help a new steward operate well.",
  "",
  "Hard rules (non-negotiable):",
  "- Assert ONLY what the supplied evidence supports. Never invent events, metrics, platforms, or numbers that are not present in the evidence.",
  "- Every candidate MUST cite, by id, the evidence items it rests on. A learning with no cited evidence is worthless — do not emit it.",
  "- Prefer a few well-supported, cross-cutting learnings over many shallow ones. If the evidence is thin, ambiguous, or purely routine, return FEWER candidates — an empty list is a correct and honest answer.",
  "- Do not restate a single event as a 'learning'. A learning generalizes across evidence or captures a pattern/outcome worth remembering.",
  "- Never include secrets, tokens, keys, or audience personal data.",
  "",
  "Each candidate: a short title (a claim), a 1–3 sentence body explaining it, a confidence in [0,1] reflecting how strongly the evidence supports it, and the list of evidence ids it cites.",
].join("\n");

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Package the Episodic + Eval projections into cited evidence lines + the map
 * that lets us verify (and rebuild) every citation against a real row. Each
 * evidence item keeps its own first provenance link as the citation target. */
export function buildEvidence(views: MemoryView[]): { prompt: EvidenceItem[]; map: Map<string, LinkSpec> } {
  const prompt: EvidenceItem[] = [];
  const map = new Map<string, LinkSpec>();
  let n = 0;
  for (const v of views) {
    const src = v.links[0];
    // No traceable provenance → not usable as evidence (honesty).
    const link: LinkSpec | null = src
      ? { kind: src.kind as MemoryLinkKind, ref: src.ref, note: src.note ?? undefined }
      : null;
    if (!link) continue;
    n += 1;
    const eid = `M${n}`;
    map.set(eid, link);
    const what = truncate(`${v.title}${v.body ? ` — ${v.body}` : ""}`.replace(/\s+/g, " ").trim(), 240);
    prompt.push({ eid, when: v.createdAt.slice(0, 10), what });
  }
  return { prompt, map };
}

/** The user turn: the evidence to reason over + existing learnings to not repeat. */
export function buildUserPrompt(evidence: EvidenceItem[], existingTitles: string[]): string {
  const lines: string[] = [];
  lines.push("EVIDENCE — cite items by their id (e.g. M1):");
  for (const e of evidence) lines.push(`[${e.eid}] (${e.when}) ${e.what}`);
  if (existingTitles.length) {
    lines.push("");
    lines.push("ALREADY DISTILLED — do not repropose these (or trivial rewordings):");
    for (const t of existingTitles.slice(0, 60)) lines.push(`- ${truncate(t, 120)}`);
  }
  lines.push("");
  lines.push("Propose the learnings that the evidence genuinely supports, each citing its evidence ids. Return an empty list if nothing rises above routine activity.");
  return lines.join("\n");
}

/** Normalize a title for duplicate detection (case/space/punctuation-insensitive). */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The honesty filter. Turns a raw model response into cited drafts:
 *  - drops candidates missing a title or body,
 *  - keeps ONLY citations that map to a real evidence item (fabricated ids are
 *    silently discarded), de-duplicated by target row,
 *  - drops any candidate left with zero real citations,
 *  - clamps confidence to [0,1].
 * Pure — no DB, no side effects. */
export function validateCandidates(raw: RawDistillResponse | null | undefined, map: Map<string, LinkSpec>): DraftCandidate[] {
  const out: DraftCandidate[] = [];
  for (const c of raw?.candidates ?? []) {
    const title = typeof c?.title === "string" ? c.title.trim() : "";
    const body = typeof c?.body === "string" ? c.body.trim() : "";
    if (!title || !body) continue;

    const cited = Array.isArray(c?.evidence) ? c.evidence : [];
    const links: LinkSpec[] = [];
    const seen = new Set<string>();
    for (const raw_eid of cited) {
      const spec = map.get(String(raw_eid));
      if (spec && !seen.has(spec.ref)) {
        seen.add(spec.ref);
        links.push(spec);
      }
    }
    if (links.length === 0) continue; // uncited (or only-fabricated citations) → dropped

    let confidence = Number(c?.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    out.push({ title: truncate(title, 300), body: truncate(body, 20_000), confidence, links });
  }
  return out;
}
