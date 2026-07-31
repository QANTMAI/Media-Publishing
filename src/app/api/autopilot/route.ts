import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { autopilotMode, autopilotOn, setSetting } from "@/lib/server/settings";
import { audit, requestIp } from "@/lib/server/audit";
import { notify } from "@/lib/server/notifications";
import { generateAutopilotDrafts, type PlannedDraft } from "@/lib/server/autopilot-plan";

/* Autopilot: ON plans a small batch across the operator's CONNECTED accounts —
 * real Post/PostTarget rows (review drafts, or scheduled + jobs in auto mode).
 * Captions are AI-generated in the operator's brand voice via one conservative
 * Anthropic call; if no key (or the call fails) it falls back to plain, clearly-
 * labeled placeholder drafts. Every draft is reviewed before publishing. OFF
 * removes the AI-planned posts that haven't published yet. */

const BATCH = 5;
const TIMES: Array<[number, number]> = [[9, 0], [12, 0], [15, 30], [18, 0], [19, 30]];

// Used only when no AI key is configured (or generation fails). Plain evergreen
// prompts the operator edits — labeled "Draft ·", never passed off as AI.
const FALLBACK: string[] = [
  "Draft · a quick win from this week worth sharing",
  "Draft · one thing we learned recently",
  "Draft · behind the scenes of what we're working on",
  "Draft · a question for our community",
  "Draft · a reminder of what we do and why it matters",
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
      return NextResponse.json({ autopilot: true, planned: 0, mode: await autopilotMode() });
    }
    // Delivery mode decides what "planning" produces:
    //  • review — drafts that wait in the dashboard review inbox (no job,
    //    nothing publishes until the operator approves each).
    //  • auto   — scheduled posts with real queue jobs, published by the worker.
    const mode = await autopilotMode();
    const isReview = mode === "review";
    const connected = await db.socialAccount.findMany({
      where: { userId, status: "connected" },
    });
    // Nothing to plan onto — turn on, but honestly plan zero (the UI explains).
    if (connected.length === 0) {
      await setSetting("autopilot", "on");
      await audit("autopilot.on", { userId, ip: requestIp(req), metadata: { planned: 0, mode, reason: "no_connected_accounts" } });
      return NextResponse.json({ autopilot: true, planned: 0, mode, reason: "no_connected_accounts" });
    }

    const categories = (await db.category.findMany({ where: { userId }, select: { name: true } })).map((c) => c.name);
    const ai = await generateAutopilotDrafts(userId, BATCH, categories);
    const drafts: PlannedDraft[] =
      ai ??
      FALLBACK.slice(0, BATCH).map((caption, i) => ({
        caption,
        category: categories[i % Math.max(1, categories.length)] ?? "Promo",
      }));

    let created = 0;
    for (let i = 0; i < drafts.length; i++) {
      // Round-robin across whatever's actually connected (incl. Bluesky).
      const account = connected[i % connected.length];
      const when = new Date();
      when.setDate(when.getDate() + i + 1);
      const [h, m] = TIMES[i % TIMES.length];
      when.setHours(h, m, 0, 0);
      const post = await db.post.create({
        data: {
          userId,
          baseCaption: drafts[i].caption,
          category: drafts[i].category,
          status: isReview ? "draft" : "scheduled",
          source: "autopilot",
          targets: { create: [{ socialAccountId: account.id, scheduledAt: when, state: isReview ? "draft" : "scheduled" }] },
        },
        include: { targets: true },
      });
      if (!isReview) {
        await db.publishJob.create({ data: { postTargetId: post.targets[0].id, runAt: when } });
      }
      created += 1;
    }
    await setSetting("autopilot", "on");
    await audit("autopilot.on", { userId, ip: requestIp(req), metadata: { planned: created, mode, ai: !!ai } });
    // In review mode, drafts wait for approval — surface that as a notification.
    if (isReview && created > 0) {
      await notify(userId, {
        type: "review_ready",
        title: `${created} draft${created > 1 ? "s" : ""} ready to review`,
        body: `Autopilot planned ${created} post${created > 1 ? "s" : ""}. Approve, edit, or discard ${created > 1 ? "them" : "it"} on your dashboard.`,
        link: "/dashboard",
        metadata: { planned: created },
      });
    }
    return NextResponse.json({ autopilot: true, planned: created, mode, ai: !!ai });
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
