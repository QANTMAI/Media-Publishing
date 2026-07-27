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
    throw new AnthropicError(res.status === 401 ? "Key was rejected (401 unauthorized)" : `Provider returned ${res.status}`);
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
