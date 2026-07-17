import { db } from "./db";

/* Operator-level flags persisted server-side so they survive sessions and are
 * visible to the worker: the publishing kill switch and autopilot state. */

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function killSwitchOn(): Promise<boolean> {
  return (await getSetting("killSwitch")) === "on";
}

export async function autopilotOn(): Promise<boolean> {
  return (await getSetting("autopilot")) === "on";
}

/** Autopilot delivery mode: hold drafts for review, or auto-schedule them. */
export async function autopilotMode(): Promise<"review" | "auto"> {
  return (await getSetting("autopilotMode")) === "auto" ? "auto" : "review";
}
