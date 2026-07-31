import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { autopilotMode, autopilotOn, setSetting } from "@/lib/server/settings";
import { audit, requestIp } from "@/lib/server/audit";
import { notify } from "@/lib/server/notifications";
import { getCredentialPlaintext } from "@/lib/server/credentials";
import { generateAutopilotDrafts, planAutopilotDrafts } from "@/lib/server/autopilot-plan";

/* Autopilot is an AI feature: ON plans a small batch of REAL, on-brand drafts
 * (one conservative Anthropic call) across the operator's CONNECTED accounts,
 * for review (or scheduled + queued in auto mode). If it can't produce real
 * drafts — no connected account, no Anthropic key, or the call fails (e.g. out
 * of credits) — it REFUSES to turn on with a reason, and never fabricates
 * generic filler. OFF removes the AI-planned posts that haven't published. */

const BATCH = 5;

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
    // Autopilot is an AI feature. If it can't produce real, on-brand drafts it
    // REFUSES to turn on (with a reason) rather than faking generic filler.
    if (connected.length === 0) {
      return NextResponse.json({ autopilot: false, planned: 0, mode, reason: "no_connected_accounts" });
    }
    if (!(await getCredentialPlaintext(userId, "anthropic"))) {
      return NextResponse.json({ autopilot: false, planned: 0, mode, reason: "no_ai_key" });
    }

    const categories = (await db.category.findMany({ where: { userId }, select: { name: true } })).map((c) => c.name);
    const drafts = await generateAutopilotDrafts(userId, BATCH, categories);
    if (!drafts || drafts.length === 0) {
      // Key is present but the call failed (commonly: out of Anthropic credits).
      return NextResponse.json({ autopilot: false, planned: 0, mode, reason: "ai_failed" });
    }

    const created = await planAutopilotDrafts(userId, drafts, connected, isReview);
    await setSetting("autopilot", "on");
    await audit("autopilot.on", { userId, ip: requestIp(req), metadata: { planned: created, mode, ai: true } });
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
    return NextResponse.json({ autopilot: true, planned: created, mode, ai: true });
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
