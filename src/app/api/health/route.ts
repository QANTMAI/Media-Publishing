import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

/* Liveness/readiness probe for load balancers and deploy smoke tests.
 * Deliberately unauthenticated and free of secrets — it returns only coarse
 * booleans/enums, never config values. 200 when the DB is reachable, 503 when
 * it isn't (so an orchestrator can pull an unhealthy instance). */
export async function GET() {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk,
    publishing: process.env.OAUTH_MOCK === "1" ? "mock" : "live",
    email: !!(process.env.SMTP_URL && process.env.SMTP_FROM),
  };
  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
