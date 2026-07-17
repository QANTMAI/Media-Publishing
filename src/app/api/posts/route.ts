import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { readSession } from "@/lib/server/session";
import { zonedTimeToUtc } from "@/lib/server/timezone";
import { audit, requestIp } from "@/lib/server/audit";
import { PLATFORM_RULES } from "@/lib/platforms";
import { validateVideoForPlatform } from "@/lib/video-specs";

/** GET /api/posts — every target with its post + account, shaped for the
 * calendar/dashboard. */
export async function GET() {
  const userId = await readSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Bounded window: the calendar/dashboard render −90d…+365d; unscheduled
  // drafts are always included. Without this the payload grows unboundedly
  // with posting history.
  const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const windowEnd = new Date(Date.now() + 365 * 24 * 60 * 60_000);
  const targets = await db.postTarget.findMany({
    where: {
      post: { userId },
      OR: [{ scheduledAt: null }, { scheduledAt: { gte: windowStart, lte: windowEnd } }],
    },
    include: {
      post: { select: { id: true, baseCaption: true, category: true, source: true } },
      account: { select: { id: true, platform: true, name: true, mark: true, handle: true, label: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 2000,
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
      assetIds: t.assetIds ? t.assetIds.split(",") : [],
      autopilot: t.post.source === "autopilot",
      demo: t.account.label === "demo",
      account: { id: t.account.id, platform: t.account.platform, name: t.account.name, mark: t.account.mark, handle: t.account.handle },
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
    assetIds?: string[];
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
  // is the enforcement point. Platforms without a rules entry have no
  // publisher integration yet: scheduling to them would only mint a job
  // guaranteed to fail, so refuse up front.
  for (const a of accounts) {
    const rules = PLATFORM_RULES[a.platform];
    if (!rules) {
      return NextResponse.json(
        { error: `${a.name} publishing is not integrated yet — remove ${a.handle} from the selection` },
        { status: 422 },
      );
    }
    if (baseCaption.length > rules.limit) {
      return NextResponse.json(
        { error: `Caption is ${baseCaption.length - rules.limit} over the ${rules.name} limit (${rules.limit})` },
        { status: 422 },
      );
    }
  }

  // Attached media must exist and belong to the operator.
  const assetIds = body.assetIds ?? [];
  if (assetIds.length) {
    const attached = await db.asset.findMany({ where: { id: { in: assetIds }, userId } });
    if (attached.length !== assetIds.length) {
      return NextResponse.json({ error: "Unknown asset in attachment" }, { status: 400 });
    }
    // Ready videos are validated against each target platform's researched
    // spec (video-specs.ts) NOW, not at publish time — the operator should
    // hear "too long for X" while composing, not from a failed job.
    // Still-transcoding videos skip this; the publisher re-checks when ready.
    for (const asset of attached) {
      if (asset.type !== "video" || asset.status !== "ready" || !asset.durationS || !asset.width) continue;
      const probe = {
        durationS: asset.durationS,
        width: asset.width,
        height: asset.height ?? 1,
        fps: 30, // renditions are capped at source/60fps; duration+aspect are the live constraints
        sizeMB: 0, // renditions are far below every platform cap
      };
      for (const a of accounts) {
        const problems = validateVideoForPlatform(a.platform, probe);
        if (problems.length) {
          return NextResponse.json(
            { error: `${asset.filename}: ${problems[0]}` },
            { status: 422 },
          );
        }
      }
    }
    if (attached.some((a) => a.status === "failed")) {
      return NextResponse.json({ error: "Attached media failed processing — remove it and retry" }, { status: 422 });
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
          assetIds: assetIds.length ? assetIds.join(",") : null,
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
