import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";

/** GET /api/auth/me — who is signed in (the portal's auth gate). */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ authed: false }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return NextResponse.json({ authed: false }, { status: 401 });
  return NextResponse.json({ authed: true, user });
}
