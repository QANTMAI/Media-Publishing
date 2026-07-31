/* Autopilot draft generation. ONE token-conservative Anthropic call produces a
 * small batch of original, brand-voice post ideas for the operator to review.
 * Runs only on an explicit Autopilot toggle (never on a timer), so token use is
 * bounded. Gated on the Anthropic key; returns null on no-key or any failure so
 * the caller falls back to plain (clearly-labeled) placeholder drafts — the
 * operator reviews/edits every draft before anything publishes. */

import { getCredentialPlaintext } from "./credentials";
import { callClaudeStructured } from "./anthropic";
import { getBrandVoice, buildVoiceCorpus } from "./brand-voice";
import { buildVoiceBlock } from "./repurpose";

const MODEL = "claude-sonnet-5";

export interface PlannedDraft {
  caption: string;
  category: string;
}

export const AUTOPILOT_SYSTEM = [
  "You plan a small batch of ORIGINAL social posts for a creator to review before posting.",
  "",
  "Rules:",
  "- Match the creator's brand voice.",
  "- Each caption is self-contained, concise (under 280 characters), and platform-agnostic.",
  "- Do NOT invent specific facts, statistics, prices, dates, or claims about real events or news — keep them evergreen and general. These are starting drafts, not reporting.",
  "- No links and no @mentions. At most two hashtags.",
  "- Vary the angle across the batch, and tag each with one category from the provided list.",
].join("\n");

export const AUTOPILOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["drafts"],
  properties: {
    drafts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caption", "category"],
        properties: { caption: { type: "string" }, category: { type: "string" } },
      },
    },
  },
} as const;

export function buildAutopilotPrompt(voiceBlock: string, corpus: string[], categories: string[], count: number): string {
  const lines: string[] = [];
  lines.push(`Write ${count} distinct post ideas.`);
  lines.push("");
  if (voiceBlock.trim()) {
    lines.push("BRAND VOICE — match this:");
    lines.push(voiceBlock.trim());
    lines.push("");
  }
  if (corpus.length) {
    lines.push("EXAMPLES of the creator's own past posts (mirror the voice):");
    corpus.slice(0, 5).forEach((c, i) => lines.push(`[${i + 1}] ${c}`));
    lines.push("");
  }
  lines.push(`CATEGORIES to choose from (use these exact names): ${categories.length ? categories.join(", ") : "Promo"}`);
  return lines.join("\n");
}

/** Normalise the model output: keep captioned drafts, snap each category to a
 * known one. Pure — exported for testing. */
export function normalizeDrafts(raw: unknown, categories: string[], count: number): PlannedDraft[] {
  const fallbackCat = categories[0] ?? "Promo";
  const arr = (raw as { drafts?: Array<{ caption?: unknown; category?: unknown }> })?.drafts ?? [];
  return arr
    .map((d) => {
      const caption = typeof d?.caption === "string" ? d.caption.trim() : "";
      const cat = typeof d?.category === "string" ? d.category.trim() : "";
      return { caption, category: categories.includes(cat) ? cat : fallbackCat };
    })
    .filter((d) => d.caption)
    .slice(0, count);
}

export async function generateAutopilotDrafts(
  userId: string,
  count: number,
  categories: string[],
): Promise<PlannedDraft[] | null> {
  const key = await getCredentialPlaintext(userId, "anthropic");
  if (!key) return null;
  const [voice, corpus] = await Promise.all([getBrandVoice(userId), buildVoiceCorpus(userId, 5)]);
  try {
    const raw = await callClaudeStructured<unknown>({
      key,
      model: MODEL,
      system: AUTOPILOT_SYSTEM,
      user: buildAutopilotPrompt(buildVoiceBlock(voice), corpus, categories, count),
      schema: AUTOPILOT_SCHEMA,
      maxTokens: 1500, // one call for the whole batch — conservative
    });
    const drafts = normalizeDrafts(raw, categories, count);
    return drafts.length ? drafts : null;
  } catch {
    return null; // fail safe — caller falls back to placeholder drafts
  }
}
