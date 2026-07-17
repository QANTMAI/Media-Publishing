import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { deleteCredential, isProvider, setCredential } from "@/lib/server/credentials";

/** PUT /api/credentials/:provider — store or replace a provider API key. The
 * key is encrypted at rest and never returned; the response carries only the
 * masked last-4 hint. */
export async function PUT(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await ctx.params;
  if (!isProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const trimmed = key?.trim() ?? "";
  // Light sanity checks only — the real proof is the live Test call. Reject the
  // obvious mistakes (empty, whitespace inside, implausibly short).
  if (!trimmed) return NextResponse.json({ error: "Key is required" }, { status: 400 });
  if (/\s/.test(trimmed)) return NextResponse.json({ error: "Key contains whitespace" }, { status: 400 });
  if (trimmed.length < 12) return NextResponse.json({ error: "That key looks too short" }, { status: 400 });

  const hint = await setCredential(userId, provider, trimmed);
  // Audit records the event only — never the key or the hint.
  await audit("credential.set", { userId, ip: requestIp(req), metadata: { provider } });
  return NextResponse.json({ ok: true, provider, hint });
}

/** DELETE /api/credentials/:provider — remove a stored key. */
export async function DELETE(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider } = await ctx.params;
  if (!isProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const removed = await deleteCredential(userId, provider);
  if (!removed) return NextResponse.json({ error: "No key saved" }, { status: 404 });
  await audit("credential.delete", { userId, ip: requestIp(req), metadata: { provider } });
  return NextResponse.json({ ok: true });
}
