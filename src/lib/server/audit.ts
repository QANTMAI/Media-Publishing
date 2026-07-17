/* Audit log write path (T-107): logins, connections, publish actions.
 * Metadata must never contain tokens or password material. */

import { db } from "./db";

export async function audit(
  action: string,
  opts: { userId?: string | null; ip?: string | null; metadata?: Record<string, unknown> } = {},
) {
  try {
    await db.auditEvent.create({
      data: {
        action,
        userId: opts.userId ?? null,
        ip: opts.ip ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    });
  } catch (err) {
    // Auditing must never take down the request path; log and continue.
    console.error("audit write failed", action, err);
  }
}

export function requestIp(req: Request): string | null {
  // X-Forwarded-For is client-controlled unless a trusted proxy sets it —
  // only honor it when the deployment says so, or audit IPs are spoofable.
  // Take the LAST entry: that's the one appended by our own proxy; earlier
  // entries are whatever the client sent.
  if (process.env.TRUST_PROXY !== "1") return null;
  const chain = req.headers.get("x-forwarded-for")?.split(",") ?? [];
  return chain.at(-1)?.trim() || null;
}
