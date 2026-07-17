import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { autopilotMode, autopilotOn, killSwitchOn, setSetting } from "@/lib/server/settings";
import { audit, requestIp } from "@/lib/server/audit";

/** GET /api/settings — operator flags the UI and worker share. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    killOn: await killSwitchOn(),
    autopilot: await autopilotOn(),
    autopilotMode: await autopilotMode(),
  });
}

/** PUT /api/settings — update operator flags: the kill switch and/or the
 * autopilot delivery mode. Each field is optional; only what's sent changes. */
export async function PUT(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    killOn?: boolean;
    autopilotMode?: "review" | "auto";
  };

  if (typeof body.killOn === "boolean") {
    await setSetting("killSwitch", body.killOn ? "on" : "off");
    await audit(body.killOn ? "publish.pause_all" : "publish.resume_all", { userId, ip: requestIp(req) });
  }
  if (body.autopilotMode === "review" || body.autopilotMode === "auto") {
    await setSetting("autopilotMode", body.autopilotMode);
    await audit("autopilot.mode", { userId, ip: requestIp(req), metadata: { mode: body.autopilotMode } });
  }
  if (typeof body.killOn !== "boolean" && !body.autopilotMode) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  return NextResponse.json({
    killOn: await killSwitchOn(),
    autopilotMode: await autopilotMode(),
  });
}
