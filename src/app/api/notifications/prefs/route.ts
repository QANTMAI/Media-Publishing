import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { audit, requestIp } from "@/lib/server/audit";
import { NOTIFY_TYPES, getNotifyPrefs, setNotifyPrefs } from "@/lib/server/notifications";
import { emailConfigured } from "@/lib/server/email";

/** GET /api/notifications/prefs — per-type toggles, the email toggle, the
 * event catalog, and whether email delivery is actually configured. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    prefs: await getNotifyPrefs(),
    types: Object.entries(NOTIFY_TYPES).map(([key, t]) => ({ key, label: t.label, description: t.description })),
    emailConfigured: emailConfigured(),
  });
}

/** PUT /api/notifications/prefs — update per-type toggles and/or the email
 * toggle. Only known keys are honored. */
export async function PUT(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { types?: Record<string, boolean>; email?: boolean };
  if (!body.types && typeof body.email !== "boolean") {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  await setNotifyPrefs(body);
  await audit("notify.prefs", { userId, ip: requestIp(req), metadata: { ...(body.types ? { types: body.types } : {}), ...(typeof body.email === "boolean" ? { email: body.email } : {}) } });
  return NextResponse.json({ ok: true, prefs: await getNotifyPrefs(), emailConfigured: emailConfigured() });
}
