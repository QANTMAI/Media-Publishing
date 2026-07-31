/* Distillation — the orchestrator (DB + Anthropic, bring-your-own-key).
 *
 * Phase 3 of the memory plan: reads the operator's Anthropic key from the
 * vault, packages the REAL Episodic + Eval projections as cited evidence, asks
 * Claude to propose durable learnings, then writes each validated, fully-cited
 * candidate as a `distillate` DRAFT for human approval. Nothing goes active
 * automatically — the operator promotes a draft (which the evidence-required
 * rule already guards). Honest no-ops throughout: no key, too little activity,
 * or a provider error all return a clear reason and write nothing.
 *
 * Anthropic-only (standing rule: never OpenAI). We call the Messages API over
 * raw HTTPS to match the existing convention (credentials.ts) rather than pull
 * in an SDK for a single call. The pure packaging/validation lives in
 * memory-distill-core.ts and is unit-tested there. */

import { db } from "./db";
import { audit } from "./audit";
import { getCredentialPlaintext } from "./credentials";
import { AI_MODEL } from "./anthropic";
import { createMemory, getMemory, type MemoryView } from "./memory";
import { projectEpisodic, projectEval } from "./memory-projections";
import {
  DISTILL_SCHEMA,
  EVIDENCE_MIN,
  SYSTEM_PROMPT,
  buildEvidence,
  buildUserPrompt,
  normalizeTitle,
  validateCandidates,
  type RawDistillResponse,
} from "./memory-distill-core";

// Skill default. The operator brings their own key, so this runs on their
// account; a structured, bounded synthesis at low effort keeps it cheap.
const MODEL = AI_MODEL;
const EPISODIC_WINDOW = 40;

export type DistillResult =
  | { ok: false; reason: "no_anthropic_key" }
  | { ok: false; reason: "insufficient_evidence"; evidenceCount: number }
  | { ok: false; reason: "api_error"; status: string }
  | { ok: false; reason: "none_valid"; proposed: number }
  | { ok: true; created: MemoryView[]; proposed: number; skipped: number };

class AnthropicError extends Error {
  constructor(public status: string) {
    super(status);
  }
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
}

/** One structured-output call to the Messages API. Returns the parsed JSON
 * candidates envelope, or throws AnthropicError with a human-readable status.
 * Never logs the key. */
async function callAnthropic(key: string, system: string, user: string): Promise<RawDistillResponse> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: user }],
        // Constrained JSON out. No `effort` — Haiku 4.5 (our model) rejects it.
        output_config: { format: { type: "json_schema", schema: DISTILL_SCHEMA } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new AnthropicError(
      err instanceof Error && err.name === "TimeoutError" ? "Timed out reaching the provider" : "Could not reach the provider",
    );
  }
  if (!res.ok) {
    throw new AnthropicError(res.status === 401 ? "Key was rejected (401 unauthorized)" : `Provider returned ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as MessagesResponse | null;
  if (!data) throw new AnthropicError("Unreadable response from the provider");
  if (data.stop_reason === "refusal") throw new AnthropicError("The provider's safety system declined the request");
  // With thinking on, content may lead with a thinking block — take the text one.
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new AnthropicError("The provider returned no content");
  try {
    return JSON.parse(text) as RawDistillResponse;
  } catch {
    throw new AnthropicError("The provider returned unparseable output");
  }
}

/** Cheap readiness check for the UI — is a key set, how much evidence exists,
 * how many distillates already stored. No model call. */
export async function distillReadiness(
  userId: string,
): Promise<{ keySet: boolean; evidenceCount: number; existingDistillates: number }> {
  const [key, episodic, evals, existing] = await Promise.all([
    getCredentialPlaintext(userId, "anthropic"),
    projectEpisodic(EPISODIC_WINDOW),
    projectEval(),
    db.memoryItem.count({ where: { lane: "distillate" } }),
  ]);
  const { prompt } = buildEvidence([...episodic, ...evals]);
  return { keySet: !!key, evidenceCount: prompt.length, existingDistillates: existing };
}

/** Run one distillation pass: propose → validate → write drafts. */
export async function distill(userId: string): Promise<DistillResult> {
  const key = await getCredentialPlaintext(userId, "anthropic");
  if (!key) return { ok: false, reason: "no_anthropic_key" };

  const [episodic, evals, priorDistillates] = await Promise.all([
    projectEpisodic(EPISODIC_WINDOW),
    projectEval(),
    // All statuses: never repropose a rejected (archived) learning either.
    db.memoryItem.findMany({ where: { lane: "distillate" }, select: { title: true } }),
  ]);

  const { prompt: evidence, map } = buildEvidence([...episodic, ...evals]);
  if (evidence.length < EVIDENCE_MIN) return { ok: false, reason: "insufficient_evidence", evidenceCount: evidence.length };

  const seenTitles = new Set(priorDistillates.map((d) => normalizeTitle(d.title)));

  let raw: RawDistillResponse;
  try {
    raw = await callAnthropic(key, SYSTEM_PROMPT, buildUserPrompt(evidence, priorDistillates.map((d) => d.title)));
  } catch (err) {
    return { ok: false, reason: "api_error", status: err instanceof AnthropicError ? err.status : "Distillation failed" };
  }

  const candidates = validateCandidates(raw, map);
  if (candidates.length === 0) return { ok: false, reason: "none_valid", proposed: raw?.candidates?.length ?? 0 };

  const createdIds: string[] = [];
  let skipped = 0;
  for (const c of candidates) {
    const norm = normalizeTitle(c.title);
    if (seenTitles.has(norm)) {
      skipped += 1;
      continue;
    }
    try {
      const item = await createMemory(userId, {
        lane: "distillate",
        status: "draft", // human-approved: never auto-active
        title: c.title,
        body: c.body,
        confidence: c.confidence,
        tags: ["ai-distilled"],
        links: c.links.map((l) => ({ kind: l.kind, ref: l.ref, note: l.note })),
      });
      seenTitles.add(norm);
      createdIds.push(item.id);
    } catch {
      // e.g. the safety guard rejected secret-shaped text — skip honestly.
      skipped += 1;
    }
  }

  const created = (await Promise.all(createdIds.map((id) => getMemory(id)))).filter((v): v is MemoryView => !!v);
  await audit("memory.distill", { userId, metadata: { proposed: candidates.length, created: created.length, skipped } });
  return { ok: true, created, proposed: candidates.length, skipped };
}
