import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { repurpose } from "@/lib/server/repurpose";
import { rateLimited } from "@/lib/server/rate-limit";

// Billable Anthropic call on the operator's key — capped like the other AI endpoints.
const REPURPOSE_MAX_PER_HOUR = 20;

/** POST /api/repurpose — adapt one source into per-channel drafts (in the
 * operator's voice), persisted as a DRAFT post for review. Gated on the
 * Anthropic key; honest no-op reasons; never auto-publishes. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`repurpose:${userId}`, REPURPOSE_MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await repurpose(userId, { source: body.source, accountIds: body.accountIds }));
}
