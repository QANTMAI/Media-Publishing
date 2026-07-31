/* AI-1 — Brand voice foundation. Prompt + retrieval voice conditioning (NOT a
 * fine-tuned model, per the roadmap/research): an editable structured guide, a
 * retrieval corpus of the operator's OWN posts, and an optional AI-distilled
 * "fingerprint" — a style descriptor derived strictly from real content, gated
 * on the operator's Anthropic key with an honest no-op when absent.
 *
 * No content is generated here. Downstream AI (repurposing, trend suggestions)
 * will consume getBrandVoice() + buildVoiceCorpus() to condition generation. */

import { db } from "./db";
import { audit } from "./audit";
import { getCredentialPlaintext } from "./credentials";
import { callClaudeStructured, AnthropicError , AI_MODEL} from "./anthropic";

// The roadmap's primary writing model — the fingerprint conditions all
// downstream generation, so quality matters; it's a one-time cached call.
const MODEL = AI_MODEL;
const CORPUS_LIMIT = 25;
/** Below this many real posts, a fingerprint needs a filled guide to be honest. */
export const MIN_CORPUS = 5;

export interface BrandVoiceView {
  tone: string;
  audience: string;
  dos: string;
  donts: string;
  bannedWords: string;
  sampleHooks: string;
  fingerprint: string | null;
  fingerprintAt: string | null;
  updatedAt: string | null;
}

interface BrandVoiceRow {
  tone: string | null;
  audience: string | null;
  dos: string | null;
  donts: string | null;
  bannedWords: string | null;
  sampleHooks: string | null;
  fingerprint: string | null;
  fingerprintAt: Date | null;
  updatedAt: Date;
}

function shape(row: BrandVoiceRow | null): BrandVoiceView {
  return {
    tone: row?.tone ?? "",
    audience: row?.audience ?? "",
    dos: row?.dos ?? "",
    donts: row?.donts ?? "",
    bannedWords: row?.bannedWords ?? "",
    sampleHooks: row?.sampleHooks ?? "",
    fingerprint: row?.fingerprint ?? null,
    fingerprintAt: row?.fingerprintAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export async function getBrandVoice(userId: string): Promise<BrandVoiceView> {
  return shape(await db.brandVoice.findUnique({ where: { userId } }));
}

export interface BrandVoiceInput {
  tone?: string;
  audience?: string;
  dos?: string;
  donts?: string;
  bannedWords?: string;
  sampleHooks?: string;
}

function clip(v: unknown, n: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, n) : null;
}

export async function upsertBrandVoice(userId: string, input: BrandVoiceInput): Promise<BrandVoiceView> {
  const data = {
    tone: clip(input.tone, 500),
    audience: clip(input.audience, 500),
    dos: clip(input.dos, 4000),
    donts: clip(input.donts, 4000),
    bannedWords: clip(input.bannedWords, 2000),
    sampleHooks: clip(input.sampleHooks, 4000),
  };
  const row = await db.brandVoice.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  await audit("brand_voice.update", { userId });
  return shape(row);
}

/** The operator's own recent, genuinely-authored captions — the retrieval
 * corpus that conditions downstream generation. Excludes autopilot's canned
 * "Draft ·" placeholders (not real voice) and de-dupes. Honest-empty when the
 * operator hasn't written anything yet. */
export async function buildVoiceCorpus(userId: string, limit = CORPUS_LIMIT): Promise<string[]> {
  const posts = await db.post.findMany({
    // ONLY genuinely operator-authored posts are voice ground-truth — exclude
    // AI-generated origins (autopilot canned, repurpose output) so the corpus
    // can't drift toward the model's own voice over time.
    where: { userId, source: "manual" },
    orderBy: { createdAt: "desc" },
    take: limit * 2, // over-fetch; we filter/dedupe below
    select: { baseCaption: true },
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of posts) {
    const c = (p.baseCaption ?? "").trim();
    if (!c || c.startsWith("Draft ·") || seen.has(c)) continue;
    seen.add(c);
    out.push(c.slice(0, 1000));
    if (out.length >= limit) break;
  }
  return out;
}

export const FINGERPRINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fingerprint"],
  properties: { fingerprint: { type: "string" } },
} as const;

export const FINGERPRINT_SYSTEM = [
  "You analyze a creator's OWN social posts and their stated brand-voice guide, and produce a concise, factual STYLE FINGERPRINT — a descriptor a writer could follow to match this voice.",
  "",
  "Hard rules:",
  "- Describe ONLY traits evidenced in the supplied material (tone, cadence, typical sentence length, vocabulary, structure, how posts open/hook, emoji and hashtag habits, formatting). Do NOT invent traits you can't see.",
  "- If there are few examples, say the fingerprint is provisional and based on limited data. Never overstate confidence.",
  "- This is descriptive analysis, not content — do not write a sample post.",
  "- Output a single 'fingerprint' string, a few tight sentences or short bullets.",
].join("\n");

export function buildFingerprintPrompt(guideText: string, corpus: string[]): string {
  const lines: string[] = [];
  if (guideText.trim()) {
    lines.push("STATED BRAND-VOICE GUIDE:");
    lines.push(guideText.trim());
    lines.push("");
  }
  if (corpus.length) {
    lines.push(`THE CREATOR'S OWN POSTS (${corpus.length} examples — the ground truth for their voice):`);
    corpus.forEach((c, i) => lines.push(`[${i + 1}] ${c}`));
  } else {
    lines.push("(No past posts yet — base the fingerprint only on the stated guide, and say it is provisional.)");
  }
  lines.push("");
  lines.push("Produce the style fingerprint, grounded only in the above.");
  return lines.join("\n");
}

export type FingerprintResult =
  | { ok: false; reason: "no_anthropic_key" }
  | { ok: false; reason: "insufficient_input"; corpus: number }
  | { ok: false; reason: "api_error"; status: string }
  | { ok: true; fingerprint: string; corpus: number };

/** Distill (and cache) the style fingerprint from the operator's real posts +
 * guide. Gated on the Anthropic key; honest no-op when there's nothing real to
 * analyze. */
export async function distillFingerprint(userId: string): Promise<FingerprintResult> {
  const key = await getCredentialPlaintext(userId, "anthropic");
  if (!key) return { ok: false, reason: "no_anthropic_key" };

  const [guide, corpus] = await Promise.all([getBrandVoice(userId), buildVoiceCorpus(userId)]);
  const guideText = [
    guide.tone && `Tone: ${guide.tone}`,
    guide.audience && `Audience: ${guide.audience}`,
    guide.dos && `Do:\n${guide.dos}`,
    guide.donts && `Don't:\n${guide.donts}`,
    guide.sampleHooks && `Sample hooks:\n${guide.sampleHooks}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Need real material: enough of the operator's own posts, or a filled guide.
  if (corpus.length < MIN_CORPUS && guideText.trim().length < 40) {
    return { ok: false, reason: "insufficient_input", corpus: corpus.length };
  }

  let parsed: { fingerprint?: string };
  try {
    parsed = await callClaudeStructured<{ fingerprint?: string }>({
      key,
      model: MODEL,
      system: FINGERPRINT_SYSTEM,
      user: buildFingerprintPrompt(guideText, corpus),
      schema: FINGERPRINT_SCHEMA,
      maxTokens: 1500,
    });
  } catch (err) {
    return { ok: false, reason: "api_error", status: err instanceof AnthropicError ? err.status : "Analysis failed" };
  }

  const fingerprint = (parsed?.fingerprint ?? "").trim();
  if (!fingerprint) return { ok: false, reason: "api_error", status: "The analysis returned nothing" };

  await db.brandVoice.upsert({
    where: { userId },
    update: { fingerprint: fingerprint.slice(0, 4000), fingerprintAt: new Date() },
    create: { userId, fingerprint: fingerprint.slice(0, 4000), fingerprintAt: new Date() },
  });
  await audit("brand_voice.analyze", { userId, metadata: { corpus: corpus.length } });
  return { ok: true, fingerprint, corpus: corpus.length };
}
