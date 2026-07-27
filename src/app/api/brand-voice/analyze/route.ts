import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { distillFingerprint } from "@/lib/server/brand-voice";
import { rateLimited } from "@/lib/server/rate-limit";

// A billable Anthropic call on the operator's key — cap it like the memory
// distill endpoint so a stuck client can't run up cost.
const ANALYZE_MAX_PER_HOUR = 10;

/** POST /api/brand-voice/analyze — distill the style fingerprint from the
 * operator's own posts + guide (gated on the Anthropic key; honest no-op). */
export async function POST() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`brand-voice:${userId}`, ANALYZE_MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  return NextResponse.json(await distillFingerprint(userId));
}
