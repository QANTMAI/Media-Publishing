/* Fixed-window in-memory rate limiter for the auth endpoints. Sufficient for
 * a single-process, single-operator deployment; swap the store for Redis if
 * the app ever runs multi-instance (the call sites won't change). */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Returns true when the caller is over the limit (caller should 429). */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  w.count += 1;
  if (windows.size > 10_000) {
    // Bound memory: drop expired windows.
    for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
  }
  return w.count > max;
}

/** Clear a key after success so legitimate retries aren't punished. */
export function rateLimitReset(key: string): void {
  windows.delete(key);
}
