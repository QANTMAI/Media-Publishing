import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { projectAuditEvents } from "@/lib/server/projections";

/** GET /api/activity — humanized, cited, read-only activity projected from the
 * audit log. One primitive, three lenses:
 *   ?scope=security   → auth events (the security timeline)
 *   ?refs=a,b         → events touching those entity ids (per-post/-account history)
 *   (default)         → recent content activity (auth excluded)
 * Never contains secrets (audit metadata is secret-free by construction). */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const refs = url.searchParams.get("refs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 40, 100);

  const items = await projectAuditEvents({
    limit,
    onlyAuth: scope === "security",
    ...(refs?.length ? { refs } : {}),
  });
  return NextResponse.json({ items });
}
