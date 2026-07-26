import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { buildBrief } from "@/lib/server/memory";

/** GET /api/memory/brief — the onboarding brief: everything the org knows,
 * composed from cited memory + live episodic/eval projections. This is what
 * onboards a new steward. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ brief: await buildBrief() });
}
