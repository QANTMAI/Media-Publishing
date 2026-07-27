import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { getBrandVoice, upsertBrandVoice } from "@/lib/server/brand-voice";

/** GET /api/brand-voice — the operator's brand-voice guide + cached fingerprint. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ voice: await getBrandVoice(userId) });
}

/** PUT /api/brand-voice — save the editable guide (tone/audience/dos/donts/…). */
export async function PUT(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const voice = await upsertBrandVoice(userId, body);
  return NextResponse.json({ voice });
}
