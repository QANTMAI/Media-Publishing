import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { autopilotOn, killSwitchOn, setSetting } from "@/lib/server/settings";
import { audit, requestIp } from "@/lib/server/audit";

/** GET /api/settings — operator flags the UI and worker share. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ killOn: await killSwitchOn(), autopilot: await autopilotOn() });
}

/** PUT /api/settings — flip the kill switch. Held jobs stay queued; the
 * worker simply refuses to claim anything while it's on. */
export async function PUT(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { killOn } = (await req.json().catch(() => ({}))) as { killOn?: boolean };
  if (typeof killOn !== "boolean") {
    return NextResponse.json({ error: "killOn (boolean) required" }, { status: 400 });
  }
  await setSetting("killSwitch", killOn ? "on" : "off");
  await audit(killOn ? "publish.pause_all" : "publish.resume_all", { userId, ip: requestIp(req) });
  return NextResponse.json({ killOn });
}
