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
import { callClaudeStructured, AnthropicError , AI_MODEL} from "./anthropic";
import { getBrandVoice, buildVoiceCorpus } from "./brand-voice";
import { buildVoiceBlock } from "./repurpose";
import { resolveArticleUrl } from "./resolve-link";

const MODEL = AI_MODEL;
const MAX_INPUT = 4_000; // clamp the headline+summary fed to the model
const DEFAULT_MAX_CHARS = 280; // tightest common limit when no platform is selected
const MIN_MAX_CHARS = 80;
const HARD_MAX_CHARS = 3_000;

export function clampMaxChars(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_CHARS;
  return Math.max(MIN_MAX_CHARS, Math.min(v, HARD_MAX_CHARS));
}

/** Hard-enforce a character budget on generated text — LLMs don't count chars
 * reliably and overshoot. Truncate at a word boundary when a sensible one
 * exists, else hard-cut, then trim trailing space/punctuation. Pure. */
export function clampToBudget(text: string, budget: number): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  const cut = t.slice(0, budget);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > budget * 0.6 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[\s.,;:!?-]+$/, "").trimEnd();
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
  | { ok: true; caption: string; overLimit: boolean; maxChars: number; link: string | null };

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

  // Resolve the link FIRST so the caption can be budgeted to leave room for it.
  // (Appending a link onto a full-length caption is what pushed drafts over the
  // platform limit.) Best-effort: null on any failure, never a broken URL.
  const link = await resolveArticleUrl(item.link).catch(() => null);
  const linkTax = link ? link.length + 2 : 0; // "\n\n" + url
  const captionBudget = Math.max(60, maxChars - linkTax);

  let raw: { caption?: unknown };
  try {
    raw = await callClaudeStructured<{ caption?: unknown }>({
      key,
      model: MODEL,
      system: FEED_CAPTION_SYSTEM,
      user: buildFeedCaptionPrompt({ title, summary, sourceTitle: item.source.title }, buildVoiceBlock(voice), corpus, captionBudget),
      schema: FEED_CAPTION_SCHEMA,
      maxTokens: 1024,
    });
  } catch (err) {
    return { ok: false, reason: "api_error", status: err instanceof AnthropicError ? err.status : "Generation failed" };
  }

  const generated = typeof raw?.caption === "string" ? raw.caption.trim() : "";
  if (!generated) return { ok: false, reason: "api_error", status: "No caption was generated" };
  // LLMs don't count characters reliably — hard-enforce the budget so that the
  // caption plus the appended link never exceeds the platform limit.
  const body = clampToBudget(generated, captionBudget);
  const caption = link ? `${body}\n\n${link}` : body;

  await audit("feed.caption", { userId, metadata: { feedItemId, chars: caption.length, resolvedLink: !!link } });
  return { ok: true, caption, overLimit: caption.length > maxChars, maxChars, link };
}
