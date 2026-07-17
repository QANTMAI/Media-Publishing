import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { autopilotOn, setSetting } from "@/lib/server/settings";
import { audit, requestIp } from "@/lib/server/audit";

/* Autopilot (T-306 lite): ON plans a week of real scheduled posts across the
 * connected accounts — real Post/PostTarget/PublishJob rows, so the worker
 * publishes them like anything else. OFF removes the AI-planned posts that
 * haven't published yet. Caption generation is canned until the AI studio
 * (T-304) lands — labeled as such, not pretending to be a model. */

/* Captions are prefixed "Draft ·", not "AI ·" — no model is involved until
 * the AI studio (T-304) ships, and the UI must not claim otherwise. */
const PLAN: Array<{ dayOffset: number; time: [number, number]; platform: string; caption: string; category: string }> = [
  { dayOffset: 1, time: [9, 0],  platform: "instagram", caption: "Draft · 5 styling tips for small spaces", category: "Educational" },
  { dayOffset: 2, time: [19, 0], platform: "tiktok",    caption: "Draft · trending audio + our spin", category: "Trend" },
  { dayOffset: 3, time: [8, 30], platform: "linkedin",  caption: "Draft · what a week of posting taught us", category: "Educational" },
  { dayOffset: 4, time: [12, 0], platform: "x",         caption: "Draft · midweek drop reminder", category: "Promo" },
  { dayOffset: 5, time: [18, 0], platform: "instagram", caption: "Draft · behind the scenes of this week", category: "Behind the scenes" },
];

export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { on } = (await req.json().catch(() => ({}))) as { on?: boolean };
  if (typeof on !== "boolean") return NextResponse.json({ error: "on (boolean) required" }, { status: 400 });

  if (on) {
    // Idempotent: a double-submit (two tabs, retried request) must not plan
    // a second week of duplicate posts.
    if (await autopilotOn()) {
      return NextResponse.json({ autopilot: true, planned: 0 });
    }
    const connected = await db.socialAccount.findMany({
      where: { userId, status: "connected" },
    });
    let created = 0;
    for (const item of PLAN) {
      // Only plan for platforms that are actually connected — piling the
      // whole plan onto one unrelated account would be spam, not help.
      const account = connected.find((a) => a.platform === item.platform);
      if (!account) continue;
      const when = new Date();
      when.setDate(when.getDate() + item.dayOffset);
      when.setHours(item.time[0], item.time[1], 0, 0);
      const post = await db.post.create({
        data: {
          userId,
          baseCaption: item.caption,
          category: item.category,
          status: "scheduled",
          source: "autopilot",
          targets: { create: [{ socialAccountId: account.id, scheduledAt: when, state: "scheduled" }] },
        },
        include: { targets: true },
      });
      await db.publishJob.create({ data: { postTargetId: post.targets[0].id, runAt: when } });
      created += 1;
    }
    await setSetting("autopilot", "on");
    await audit("autopilot.on", { userId, ip: requestIp(req), metadata: { planned: created } });
    return NextResponse.json({ autopilot: true, planned: created });
  }

  // OFF: remove AI-planned posts that haven't gone out (cascade deletes
  // targets + jobs); published history stays. Single conditional deleteMany —
  // no check-then-delete window — and posts with a claimed (in-flight) job
  // are left alone for the worker to finish.
  const removed = await db.post.deleteMany({
    where: {
      userId,
      source: "autopilot",
      targets: {
        none: {
          OR: [
            { state: { in: ["published", "publishing"] } },
            { jobs: { some: { completedAt: null, claimedAt: { not: null } } } },
          ],
        },
      },
    },
  });
  await setSetting("autopilot", "off");
  await audit("autopilot.off", { userId, ip: requestIp(req), metadata: { removed: removed.count } });
  return NextResponse.json({ autopilot: false, removed: removed.count });
}
