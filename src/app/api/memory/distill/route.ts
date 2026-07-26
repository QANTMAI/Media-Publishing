import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { distill, distillReadiness } from "@/lib/server/memory-distill";

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
  const result = await distill(userId);
  return NextResponse.json(result);
}
