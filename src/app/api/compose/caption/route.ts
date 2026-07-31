import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { polishCaption } from "@/lib/server/compose-caption";

const MAX_PER_HOUR = 30;

/** POST /api/compose/caption — rewrite the operator's draft into a brand-voice
 * caption. Gated on the Anthropic key; honest no-op reasons; draft-only. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`compose-caption:${userId}`, MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await polishCaption(userId, { text: body.text, maxChars: body.maxChars }));
}
