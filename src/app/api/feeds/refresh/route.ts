import { NextResponse } from "next/server";
import { readSession } from "@/lib/server/session";
import { listItems, pollFeeds } from "@/lib/server/feeds";

/** POST /api/feeds/refresh — poll all of the operator's enabled feeds now and
 * return the refreshed item list. Backs the "Refresh" button on the trending
 * surface (the worker also polls every few hours on its own). */
export async function POST() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { polled } = await pollFeeds({ userId });
  const items = await listItems(userId);
  return NextResponse.json({ polled, items });
}
