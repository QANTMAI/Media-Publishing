/* AI caption from a trending news item. Takes a stored FeedItem (looked up by
 * id, ownership-checked — never trusts client-supplied article text) and writes
 * ONE social caption in the operator's brand voice (AI-1), grounded strictly in
 * the item's headline + summary. The result seeds the composer as an editable
 * DRAFT — the operator reviews and approves before anything schedules.
 *
 * Quality gate — accuracy is treated as health/safety here (this is real news):
 * the model may use ONLY the provided facts, must not invent stats/quotes/
 * outcomes, and must preserve the source's hedging ("in talks", "reportedly").
 * Gated on the Anthropic key with an honest no-op; rate-limited at the route. */

import { db } from "./db";
import { audit } from "./audit";
import { getCredentialPlaintext } from "./credentials";
import { callClaudeStructured, AnthropicError } from "./anthropic";
import { getBrandVoice, buildVoiceCorpus } from "./brand-voice";
import { buildVoiceBlock } from "./repurpose";

const MODEL = "claude-sonnet-5";
const MAX_INPUT = 4_000; // clamp the headline+summary fed to the model
const DEFAULT_MAX_CHARS = 280; // tightest common limit when no platform is selected
const MIN_MAX_CHARS = 80;
const HARD_MAX_CHARS = 3_000;

export function clampMaxChars(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_CHARS;
  return Math.max(MIN_MAX_CHARS, Math.min(v, HARD_MAX_CHARS));
}

export const FEED_CAPTION_SYSTEM = [
  "You write ONE social-media caption about a NEWS item for a creator.",
  "",
  "Accuracy rules (this is real news — treat accuracy as critical):",
  "- Use ONLY the facts in the provided headline and summary. Do NOT invent statistics, quotes, names, outcomes, dates, or claims that are not present. If the summary is thin, keep the caption general rather than fabricating specifics.",
  "- Preserve the source's uncertainty: if it says 'in talks', 'reportedly', 'alleged', or 'proposed', do not restate it as settled fact.",
  "- Do not editorialize a claim into a stronger one than the source supports.",
  "",
  "Format rules:",
  "- No URLs and no @mentions (a clean link is added separately). Hashtags only if clearly warranted, at most two, at the end.",
  "- Match the creator's brand voice when one is provided.",
  "- Stay within the given character limit.",
  "- Output exactly one caption — no preamble, no alternatives, no quotation marks around the whole thing.",
].join("\n");

export const FEED_CAPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption"],
  properties: { caption: { type: "string" } },
} as const;

export interface FeedCaptionSource {
  title: string;
  summary?: string | null;
  sourceTitle?: string | null;
}

/** Pure prompt builder — testable without a live model call. */
export function buildFeedCaptionPrompt(
  item: FeedCaptionSource,
  voiceBlock: string,
  corpus: string[],
  maxChars: number,
): string {
  const lines: string[] = [];
  lines.push(`NEWS ITEM — write about ONLY what appears here; introduce no facts not present:`);
  lines.push(`Headline: ${item.title.trim()}`);
  if (item.summary && item.summary.trim()) lines.push(`Summary: ${item.summary.trim()}`);
  if (item.sourceTitle && item.sourceTitle.trim()) lines.push(`Source: ${item.sourceTitle.trim()}`);
  lines.push("");
  if (voiceBlock.trim()) {
    lines.push("BRAND VOICE — match this:");
    lines.push(voiceBlock.trim());
    lines.push("");
  }
  if (corpus.length) {
    lines.push("EXAMPLES of the creator's own past posts (mirror the voice, not the topic):");
    corpus.slice(0, 5).forEach((c, i) => lines.push(`[${i + 1}] ${c}`));
    lines.push("");
  }
  lines.push(`Write one caption of at most ${maxChars} characters.`);
  return lines.join("\n");
}

export type FeedCaptionResult =
  | { ok: false; reason: "no_anthropic_key" }
  | { ok: false; reason: "no_item" }
  | { ok: false; reason: "no_source" }
  | { ok: false; reason: "api_error"; status: string }
  | { ok: true; caption: string; overLimit: boolean; maxChars: number };

export async function generateFeedCaption(
  userId: string,
  input: { feedItemId?: string; maxChars?: number },
): Promise<FeedCaptionResult> {
  const key = await getCredentialPlaintext(userId, "anthropic");
  if (!key) return { ok: false, reason: "no_anthropic_key" };

  const feedItemId = (input.feedItemId ?? "").trim();
  if (!feedItemId) return { ok: false, reason: "no_item" };

  // Look up the stored item and verify it belongs to this operator (via its
  // source). The article text comes from our DB, never from the client.
  const item = await db.feedItem.findFirst({
    where: { id: feedItemId, source: { userId } },
    include: { source: { select: { title: true } } },
  });
  if (!item) return { ok: false, reason: "no_item" };

  const title = (item.title ?? "").trim().slice(0, MAX_INPUT);
  if (!title) return { ok: false, reason: "no_source" };
  const summary = (item.summary ?? "").trim().slice(0, MAX_INPUT) || null;
  const maxChars = clampMaxChars(input.maxChars);

  const [voice, corpus] = await Promise.all([getBrandVoice(userId), buildVoiceCorpus(userId, 5)]);

  let raw: { caption?: unknown };
  try {
    raw = await callClaudeStructured<{ caption?: unknown }>({
      key,
      model: MODEL,
      system: FEED_CAPTION_SYSTEM,
      user: buildFeedCaptionPrompt({ title, summary, sourceTitle: item.source.title }, buildVoiceBlock(voice), corpus, maxChars),
      schema: FEED_CAPTION_SCHEMA,
      maxTokens: 1024,
    });
  } catch (err) {
    return { ok: false, reason: "api_error", status: err instanceof AnthropicError ? err.status : "Generation failed" };
  }

  const caption = typeof raw?.caption === "string" ? raw.caption.trim() : "";
  if (!caption) return { ok: false, reason: "api_error", status: "No caption was generated" };

  await audit("feed.caption", { userId, metadata: { feedItemId, chars: caption.length } });
  return { ok: true, caption, overLimit: caption.length > maxChars, maxChars };
}
