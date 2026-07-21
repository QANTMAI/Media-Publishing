/* Shared publish contracts, extracted so platform modules (meta, linkedin, …)
 * and the publisher can import them without circular dependencies. */

/** Fails the target immediately — no retry can fix it (missing integration,
 * dead token, rejected content). Anything else is retryable with backoff. */
export class PermanentError extends Error {
  permanent = true as const;
}

export interface PublishResult {
  permalink: string;
  /** Platform-side media/post id — the key for later insights pulls.
   * Prefixed "mock_" for mock publishes (which never get metrics). */
  externalMediaId: string | null;
}
