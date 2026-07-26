import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { distill, distillReadiness } from "@/lib/server/memory-distill";
import { rateLimited } from "@/lib/server/rate-limit";

// Distillation is a billable Anthropic call on the operator's own key. Cap it so
// a stuck client / double-click can't run up cost: at most N runs per window.
const DISTILL_MAX_PER_HOUR = 10;

/** GET /api/memory/distill — readiness for the UI (is the Anthropic key set,
 * how much real activity is available to distill). No model call, no cost. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await distillReadiness(userId));
}

/** POST /api/memory/distill — run one distillation pass over the live Episodic
 * + Eval projections. Proposes AI learnings as DRAFT `distillate` items, each
 * citing real evidence; the operator promotes what's true. Honest no-op (200
 * with a reason) when there's no key or too little activity — never an invented
 * insight. */
export async function POST() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`distill:${userId}`, DISTILL_MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const result = await distill(userId);
  return NextResponse.json(result);
}
