import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { listCredentials } from "@/lib/server/credentials";

/** GET /api/credentials — masked view of every supported provider. Never
 * returns a key or ciphertext, only whether one is set + its last-4 hint. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ credentials: await listCredentials(userId) });
}
