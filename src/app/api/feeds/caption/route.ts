import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { rateLimited } from "@/lib/server/rate-limit";
import { generateFeedCaption } from "@/lib/server/feed-caption";

// Billable Anthropic call on the operator's key — capped like the other AI endpoints.
const CAPTION_MAX_PER_HOUR = 40;

/** POST /api/feeds/caption — write an AI caption (in the operator's voice,
 * grounded strictly in the stored feed item) to seed the composer as a DRAFT.
 * Gated on the Anthropic key; honest no-op reasons; never auto-publishes. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (rateLimited(`feed-caption:${userId}`, CAPTION_MAX_PER_HOUR, 60 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await generateFeedCaption(userId, { feedItemId: body.feedItemId, maxChars: body.maxChars }));
}
