import { db } from "./db";

/* Demo account rows created for the operator at setup so every screen renders
 * populated before any real OAuth connection exists. Labeled "demo"; real
 * connects create their own rows keyed by the platform's real external id. */

const DEMO_ACCOUNTS = [
  { platform: "instagram", externalId: "demo_ig_1", name: "Instagram", mark: "IG", handle: "@qantm.media", status: "connected" },
  { platform: "instagram", externalId: "demo_ig_2", name: "Instagram", mark: "IG", handle: "@qantm.studio", status: "connected" },
  { platform: "instagram", externalId: "demo_ig_3", name: "Instagram", mark: "IG", handle: "@qantm.behindthescenes", status: "disconnected" },
  { platform: "facebook", externalId: "demo_fb_1", name: "Facebook", mark: "FB", handle: "QANTM Media", status: "connected" },
  { platform: "facebook", externalId: "demo_fb_2", name: "Facebook", mark: "FB", handle: "QANTM Community", status: "disconnected" },
  { platform: "x", externalId: "demo_x_1", name: "X", mark: "X", handle: "@qantmmedia", status: "connected" },
  { platform: "x", externalId: "demo_x_2", name: "X", mark: "X", handle: "@qantm_news", status: "connected" },
  { platform: "x", externalId: "demo_x_3", name: "X", mark: "X", handle: "@qantm_support", status: "disconnected" },
  { platform: "linkedin", externalId: "demo_in_1", name: "LinkedIn", mark: "IN", handle: "QANTM Media", status: "expiring" },
  { platform: "youtube", externalId: "demo_yt_1", name: "YouTube", mark: "YT", handle: "QANTM Media", status: "connected" },
  { platform: "tiktok", externalId: "demo_tt_1", name: "TikTok", mark: "TT", handle: "@qantm", status: "disconnected" },
  { platform: "threads", externalId: "demo_th_1", name: "Threads", mark: "TH", handle: "@qantm.media", status: "disconnected" },
  { platform: "bluesky", externalId: "demo_bs_1", name: "Bluesky", mark: "BS", handle: "@qantm.bsky", status: "disconnected" },
  { platform: "pinterest", externalId: "demo_pn_1", name: "Pinterest", mark: "PN", handle: "QANTM", status: "disconnected" },
  { platform: "gbp", externalId: "demo_gb_1", name: "Google Business", mark: "GB", handle: "QANTM Media", status: "disconnected" },
];

export async function seedDemoAccounts(userId: string) {
  for (const a of DEMO_ACCOUNTS) {
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: a.platform, externalId: a.externalId } },
      create: { ...a, userId, label: "demo" },
      update: {},
    });
  }
  await seedDemoPosts(userId);
}

/* Demo posts relative to today: published history, upcoming scheduled posts
 * (with real queue jobs — the worker treats them like any other), one failed,
 * one draft. Gives the calendar/dashboard/analytics real rows to render. */
const DEMO_POSTS: Array<{
  externalId: string;
  dayOffset: number; // relative to today
  time: [number, number];
  category: string;
  state: "published" | "scheduled" | "failed" | "draft";
  caption: string;
  error?: string;
}> = [
  { externalId: "demo_ig_1", dayOffset: -5, time: [9, 0],   category: "Promo",             state: "published", caption: "Summer capsule drop — link in bio" },
  { externalId: "demo_x_1",  dayOffset: -3, time: [12, 30], category: "Educational",       state: "published", caption: "3 quick tips for better product photos" },
  { externalId: "demo_in_1", dayOffset: -1, time: [8, 0],   category: "Educational",       state: "published", caption: "How we built our brand voice" },
  { externalId: "demo_x_1",  dayOffset: -1, time: [11, 0],  category: "News",              state: "failed",    caption: "Reacting to industry news", error: "X API rejected the post: token expired" },
  { externalId: "demo_ig_2", dayOffset: 1,  time: [18, 0],  category: "Behind the scenes", state: "scheduled", caption: "Studio day — behind the scenes" },
  { externalId: "demo_yt_1", dayOffset: 2,  time: [15, 0],  category: "Tutorial",          state: "scheduled", caption: "Full studio tour (10 min)" },
  { externalId: "demo_ig_1", dayOffset: 3,  time: [18, 0],  category: "Promo",             state: "scheduled", caption: "New arrivals this week" },
  { externalId: "demo_tt_1", dayOffset: 4,  time: [19, 0],  category: "Trend",             state: "draft",     caption: "Trending sound + our take" },
  { externalId: "demo_fb_1", dayOffset: 6,  time: [10, 0],  category: "Promo",             state: "scheduled", caption: "Weekend sale announcement" },
  { externalId: "demo_in_1", dayOffset: 11, time: [9, 30],  category: "Educational",       state: "scheduled", caption: "Lessons from Q2" },
];

async function seedDemoPosts(userId: string) {
  if ((await db.post.count({ where: { userId } })) > 0) return; // idempotent

  for (const p of DEMO_POSTS) {
    const account = await db.socialAccount.findFirst({ where: { externalId: p.externalId } });
    if (!account) continue;
    const when = new Date();
    when.setDate(when.getDate() + p.dayOffset);
    when.setHours(p.time[0], p.time[1], 0, 0);

    const post = await db.post.create({
      data: {
        userId,
        baseCaption: p.caption,
        category: p.category,
        status: p.state === "draft" ? "draft" : p.state,
        targets: {
          create: [
            {
              socialAccountId: account.id,
              scheduledAt: p.state === "draft" ? null : when,
              state: p.state,
              permalink: p.state === "published" ? `https://mock.qantm.local/${account.platform}/seeded` : null,
              error: p.error ?? null,
            },
          ],
        },
      },
      include: { targets: true },
    });
    if (p.state === "scheduled") {
      await db.publishJob.create({ data: { postTargetId: post.targets[0].id, runAt: when } });
    }
  }
}
