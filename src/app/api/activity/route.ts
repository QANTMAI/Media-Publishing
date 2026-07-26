import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { projectAuditEvents, projectFeedActivity, projectMetrics, projectPublishQueue } from "@/lib/server/projections";

/** GET /api/activity — the humanized, cited, read-only projection lens over any
 * authoritative store.
 *   ?source=queue|feed|metric   → the publish queue / trend feed / metrics store
 *   (default source = audit):
 *     ?scope=security           → auth events (the security timeline)
 *     ?refs=a,b                 → events touching those entity ids (per-entity history)
 *     (else)                    → recent content activity (auth excluded)
 * Never contains secrets (metadata is secret-free by construction). */
export async function GET(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const source = url.searchParams.get("source") ?? "audit";
  const scope = url.searchParams.get("scope");
  const refs = url.searchParams.get("refs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 40, 100);

  let items;
  switch (source) {
    case "queue":
      items = await projectPublishQueue(limit);
      break;
    case "feed":
      items = await projectFeedActivity(limit);
      break;
    case "metric":
      items = await projectMetrics(limit);
      break;
    default:
      items = await projectAuditEvents({ limit, onlyAuth: scope === "security", ...(refs?.length ? { refs } : {}) });
  }
  return NextResponse.json({ items });
}
