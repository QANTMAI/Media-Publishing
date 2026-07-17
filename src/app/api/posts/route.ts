import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { zonedTimeToUtc } from "@/lib/server/timezone";
import { audit, requestIp } from "@/lib/server/audit";
import { PLATFORM_RULES } from "@/lib/platforms";

/** GET /api/posts — every target with its post + account, shaped for the
 * calendar/dashboard. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targets = await db.postTarget.findMany({
    where: { post: { userId } },
    include: {
      post: { select: { id: true, baseCaption: true, category: true, source: true } },
      account: { select: { id: true, platform: true, name: true, mark: true, handle: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json({
    targets: targets.map((t) => ({
      id: t.id,
      postId: t.post.id,
      caption: t.captionOverride?.trim() || t.post.baseCaption,
      category: t.post.category,
      status: t.state,
      scheduledAt: t.scheduledAt?.toISOString() ?? null,
      permalink: t.permalink,
      error: t.error,
      autopilot: t.post.source === "autopilot",
      account: t.account,
    })),
  });
}

/** POST /api/posts — schedule a post to a set of accounts. Creates the Post,
 * one PostTarget per account, and one delayed PublishJob per target. */
export async function POST(req: Request) {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    baseCaption?: string;
    category?: string;
    accountIds?: string[];
    date?: string;
    time?: string;
    tz?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const baseCaption = body.baseCaption?.trim() ?? "";
  if (!baseCaption) return NextResponse.json({ error: "Caption is required" }, { status: 400 });
  if (!body.accountIds?.length) {
    return NextResponse.json({ error: "Select at least one account" }, { status: 400 });
  }

  let scheduledAt: Date;
  try {
    scheduledAt = zonedTimeToUtc(body.date ?? "", body.time ?? "", body.tz ?? "");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid schedule" }, { status: 400 });
  }
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Scheduled time is in the past" }, { status: 400 });
  }

  const accounts = await db.socialAccount.findMany({
    where: { id: { in: body.accountIds }, userId },
  });
  if (accounts.length !== body.accountIds.length) {
    return NextResponse.json({ error: "Unknown account in selection" }, { status: 400 });
  }
  const unconnected = accounts.filter((a) => a.status === "disconnected");
  if (unconnected.length) {
    return NextResponse.json(
      { error: `Not connected: ${unconnected.map((a) => a.handle).join(", ")}` },
      { status: 409 },
    );
  }

  // Server-side rules engine check — the composer validates live, but the API
  // is the enforcement point.
  for (const a of accounts) {
    const rules = PLATFORM_RULES[a.platform];
    if (rules && baseCaption.length > rules.limit) {
      return NextResponse.json(
        { error: `Caption is ${baseCaption.length - rules.limit} over the ${rules.name} limit (${rules.limit})` },
        { status: 422 },
      );
    }
  }

  const post = await db.post.create({
    data: {
      userId,
      baseCaption,
      category: body.category ?? "Promo",
      status: "scheduled",
      targets: {
        create: accounts.map((a) => ({
          socialAccountId: a.id,
          scheduledAt,
          state: "scheduled",
        })),
      },
    },
    include: { targets: true },
  });
  await db.publishJob.createMany({
    data: post.targets.map((t) => ({ postTargetId: t.id, runAt: scheduledAt })),
  });

  await audit("post.schedule", {
    userId,
    ip: requestIp(req),
    metadata: { postId: post.id, targets: post.targets.length, scheduledAt: scheduledAt.toISOString() },
  });
  return NextResponse.json({ postId: post.id, targetCount: post.targets.length, scheduledAt }, { status: 201 });
}
