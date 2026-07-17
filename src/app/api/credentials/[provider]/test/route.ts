import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { isProvider, testCredential } from "@/lib/server/credentials";

/** POST /api/credentials/:provider/test — validate the stored key with a real,
 * cheap authenticated call to the provider (server-side only; the key never
 * touches the client). Records the outcome on the credential. */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await ctx.params;
  if (!isProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const result = await testCredential(userId, provider);
  await audit("credential.test", { userId, ip: requestIp(req), metadata: { provider, ok: result.ok } });
  return NextResponse.json(result);
}
