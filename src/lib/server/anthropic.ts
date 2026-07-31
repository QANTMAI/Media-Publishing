/* Shared Anthropic Messages API helper — structured (JSON-schema) output over
 * raw HTTPS, matching the project convention (no SDK; see credentials.ts,
 * memory-distill.ts). Bring-your-own-key: callers pass the operator's decrypted
 * Anthropic key. Anthropic ONLY — never OpenAI (standing rule).
 *
 * Returns the parsed, schema-shaped JSON object, or throws AnthropicError with a
 * human-readable status. The key is never logged. */

export class AnthropicError extends Error {
  constructor(public status: string) {
    super(status);
  }
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
}

/** The single model used by all AI features. Haiku 4.5 is the least expensive
 * current Claude model ($1/$5 per 1M in/out) — pinned to the dated snapshot for
 * reproducibility. Change it here to switch every AI feature at once. All
 * outputs are human-reviewed drafts. */
export const AI_MODEL = "claude-haiku-4-5-20251001";

export interface ClaudeStructuredOpts {
  key: string;
  model: string;
  system: string;
  user: string;
  /** JSON Schema for output_config.format (constrained decoding). */
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
}

export async function callClaudeStructured<T = unknown>(opts: ClaudeStructuredOpts): Promise<T> {
  const { key, model, system, user, schema, maxTokens = 4096, effort = "low", timeoutMs = 60_000 } = opts;
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema }, effort },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AnthropicError(
      err instanceof Error && err.name === "TimeoutError" ? "Timed out reaching the provider" : "Could not reach the provider",
    );
  }
  if (!res.ok) {
    // Surface the provider's own reason so failures are actionable, not an
    // opaque "Provider returned 400". The error body carries no secrets.
    const detail = await res.text().catch(() => "");
    let providerMsg = "";
    try {
      providerMsg = (JSON.parse(detail) as { error?: { message?: string } })?.error?.message ?? "";
    } catch {
      // non-JSON body — ignore
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 401) {
      console.error(`[anthropic] ${res.status} on ${model}: ${detail.slice(0, 500)}`);
    }
    let status: string;
    if (res.status === 401) status = "Key was rejected (401 unauthorized)";
    else if (/credit balance/i.test(providerMsg)) status = "Anthropic credit balance too low — add credits in your Anthropic console";
    else if (res.status === 429) status = "Rate limited by Anthropic — wait a moment and retry";
    else if (providerMsg) status = providerMsg.slice(0, 160);
    else status = `Provider returned ${res.status}`;
    throw new AnthropicError(status);
  }
  const data = (await res.json().catch(() => null)) as MessagesResponse | null;
  if (!data) throw new AnthropicError("Unreadable response from the provider");
  if (data.stop_reason === "refusal") throw new AnthropicError("The provider's safety system declined the request");
  // With adaptive thinking on, content may lead with a thinking block — take the text one.
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new AnthropicError("The provider returned no content");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AnthropicError("The provider returned unparseable output");
  }
}
