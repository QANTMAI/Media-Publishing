/* Integration tests: the real HTTP API on the running dev server
 * (http://localhost:3000) + the real queue/worker against the real SQLite db.
 * Auth uses the genuine flow — password login, then a TOTP code computed from
 * the enrolled secret, exactly as an authenticator app would.
 *
 * Requires: `npm run dev` running, and the operator account from first-run
 * setup. Run: npm test */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Local-only dev credentials (the operator created in first-run setup).
// Override via env when your local setup differs.
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.TEST_EMAIL ?? "info@qantm.ai";
const PASSWORD = process.env.TEST_PASSWORD ?? "qantm-dev-2026!";

const { PrismaClient } = await import("@prisma/client");
const { authenticator } = await import("otplib");
const db = new PrismaClient();

// ── tiny cookie jar ───────────────────────────────────────────────────────
const jar = new Map<string, string>();
function storeCookies(res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [name, ...v] = pair.split("=");
    const value = v.join("=");
    if (value === "" || /Expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name.trim());
    else jar.set(name.trim(), value);
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      cookie: cookieHeader(),
      ...(init.headers ?? {}),
    },
  });
  storeCookies(res);
  return res;
}

let userId: string;
let totpSecret: string;
let usedCode: string;

before(async () => {
  const user = await db.user.findUnique({ where: { email: EMAIL } });
  assert.ok(user?.totpSecret, "operator account must exist (run first-run setup)");
  userId = user.id;

  // Real sign-in: wrong password rejected, right password + TOTP accepted.
  const bad = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: "wrong-password" }),
  });
  assert.equal(bad.status, 401, "wrong password must 401");

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200, "password login failed — check dev credentials");

  // The replay guard rejects a TOTP step that was already consumed (e.g. by a
  // previous test run inside the same 30s window) — wait for the next step.
  totpSecret = user.totpSecret!;
  usedCode = authenticator.generate(totpSecret);
  let verify = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ code: usedCode }) });
  if (verify.status === 401) {
    const msRemaining = 30_000 - (Date.now() % 30_000);
    await new Promise((r) => setTimeout(r, msRemaining + 500));
    usedCode = authenticator.generate(totpSecret);
    verify = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ code: usedCode }) });
  }
  assert.equal(verify.status, 200, "TOTP verify failed");
});

after(async () => {
  // Leave the kill switch off and close the db handle.
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ killOn: false }) });
  await db.$disconnect();
});

test("a consumed TOTP code cannot be replayed", async () => {
  // Fresh preauth (session cookie stays valid; this only re-runs the 2FA gate).
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const replay = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ code: usedCode }) });
  assert.equal(replay.status, 401, "replayed code must be rejected");
  const body = await replay.json();
  assert.match(body.error, /already used|didn't match/i);
  // Restore the full session for the remaining tests (next step's code).
  const msRemaining = 30_000 - (Date.now() % 30_000);
  await new Promise((r) => setTimeout(r, msRemaining + 500));
  const verify = await api("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ code: authenticator.generate(totpSecret) }),
  });
  assert.equal(verify.status, 200);
});

test("unauthenticated requests are rejected", async () => {
  const anon = await fetch(`${BASE}/api/posts`);
  assert.equal(anon.status, 401);
  const anon2 = await fetch(`${BASE}/api/settings`, { method: "PUT", body: JSON.stringify({ killOn: true }) });
  assert.equal(anon2.status, 401);
});

test("GET /api/posts returns seeded targets with account joins", async () => {
  const res = await api("/api/posts");
  assert.equal(res.status, 200);
  const { targets } = await res.json();
  assert.ok(Array.isArray(targets) && targets.length > 0, "expected seeded posts");
  const t = targets[0];
  assert.ok(t.id && t.caption && t.account?.mark, "target shape");
});

test("schedule validation: past time, empty caption, over-limit caption", async () => {
  const ig = await db.socialAccount.findFirst({ where: { platform: "instagram", status: "connected" } });
  const x = await db.socialAccount.findFirst({ where: { platform: "x", status: "connected" } });
  assert.ok(ig && x, "need connected instagram + x accounts");

  const past = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "hi", accountIds: [ig!.id], date: "2020-01-01", time: "10:00", tz: "UTC" }),
  });
  assert.equal(past.status, 400);

  const empty = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "  ", accountIds: [ig!.id], date: "2030-01-01", time: "10:00", tz: "UTC" }),
  });
  assert.equal(empty.status, 400);

  const overX = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "x".repeat(300),
      accountIds: [x!.id],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  assert.equal(overX.status, 422, "over-280 caption to X must be rejected server-side");
});

test("schedule → queue → worker publishes via mock token; no-token target fails permanently", async () => {
  const ig = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  const yt = await db.socialAccount.findFirst({ where: { platform: "youtube" } }); // demo row, no token
  assert.ok(ig, "need a mock-connected instagram account (run the mock OAuth connect)");
  assert.ok(yt, "need the seeded youtube account");

  const res = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "integration test post",
      category: "Promo",
      accountIds: [ig!.id, yt!.id],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  assert.equal(res.status, 201);
  const { postId, targetCount } = await res.json();
  assert.equal(targetCount, 2);

  // Make both jobs due now, then run a real worker cycle in-process.
  const targets = await db.postTarget.findMany({ where: { postId } });
  await db.publishJob.updateMany({
    where: { postTargetId: { in: targets.map((t) => t.id) } },
    data: { runAt: new Date(Date.now() - 1000) },
  });
  const { runQueueCycle } = await import("../src/lib/server/worker");
  await runQueueCycle();

  const after1 = await db.postTarget.findMany({ where: { postId }, include: { account: true } });
  const igTarget = after1.find((t) => t.account.platform === "instagram")!;
  const ytTarget = after1.find((t) => t.account.platform === "youtube")!;

  assert.equal(igTarget.state, "published", `ig target: ${igTarget.state} ${igTarget.error ?? ""}`);
  assert.ok(igTarget.permalink?.includes("mock.qantm.local"), "mock permalink stored");
  assert.equal(ytTarget.state, "failed", "no-token target must fail permanently");
  assert.match(ytTarget.error ?? "", /not connected|no credentials/i);

  const jobs = await db.publishJob.findMany({ where: { postTargetId: { in: targets.map((t) => t.id) } } });
  assert.ok(jobs.every((j) => j.completedAt), "both jobs closed (success + permanent failure)");

  // Cleanup this test's post.
  await db.post.delete({ where: { id: postId } });
});

test("kill switch holds the queue", async () => {
  const ig = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  const res = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "kill switch hold test",
      accountIds: [ig!.id],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  const { postId } = await res.json();
  const target = await db.postTarget.findFirst({ where: { postId } });
  await db.publishJob.updateMany({ where: { postTargetId: target!.id }, data: { runAt: new Date(Date.now() - 1000) } });

  const on = await api("/api/settings", { method: "PUT", body: JSON.stringify({ killOn: true }) });
  assert.equal(on.status, 200);

  const { runQueueCycle } = await import("../src/lib/server/worker");
  const held = await runQueueCycle();
  assert.equal(held.processed, 0, "kill switch on → nothing claimed");
  const stillQueued = await db.publishJob.findFirst({ where: { postTargetId: target!.id } });
  assert.equal(stillQueued!.completedAt, null, "job still queued while held");

  await api("/api/settings", { method: "PUT", body: JSON.stringify({ killOn: false }) });
  await runQueueCycle();
  const done = await db.postTarget.findFirst({ where: { id: target!.id } });
  assert.equal(done!.state, "published", "resumes publishing after kill switch off");

  await db.post.delete({ where: { id: postId } });
});

test("reschedule moves the pending job; cancel removes it and drops to draft", async () => {
  const ig = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  const res = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "reschedule/cancel test",
      accountIds: [ig!.id],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  const { postId } = await res.json();
  const target = await db.postTarget.findFirst({ where: { postId } });

  const newTime = "2030-02-02T15:30:00.000Z";
  const patch = await api(`/api/targets/${target!.id}`, {
    method: "PATCH",
    body: JSON.stringify({ scheduledAt: newTime }),
  });
  assert.equal(patch.status, 200);
  const movedJob = await db.publishJob.findFirst({ where: { postTargetId: target!.id, completedAt: null } });
  assert.equal(movedJob!.runAt.toISOString(), newTime, "job runAt follows the reschedule");

  const cancel = await api(`/api/targets/${target!.id}/cancel`, { method: "POST" });
  assert.equal(cancel.status, 200);
  const afterCancel = await db.postTarget.findFirst({ where: { id: target!.id } });
  assert.equal(afterCancel!.state, "draft", "cancelled posts drop back to drafts");
  const pendingJobs = await db.publishJob.count({ where: { postTargetId: target!.id, completedAt: null } });
  assert.equal(pendingJobs, 0, "pending job removed");

  await db.post.delete({ where: { id: postId } });
});

test("media pipeline: presign → upload → variants → list → attach → in-use guard → delete", async () => {
  // A real 1200×900 JPEG generated in-process — no fixtures, no fakes.
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 47, g: 84, b: 209 } },
  })
    .jpeg()
    .toBuffer();

  // Presign validates the declaration.
  const badMime = await api("/api/assets/presign", {
    method: "POST",
    body: JSON.stringify({ kind: "image", mime: "application/zip", size: 100, filename: "x.zip" }),
  });
  assert.equal(badMime.status, 422, "non-media mime refused");

  const presign = await api("/api/assets/presign", {
    method: "POST",
    body: JSON.stringify({ kind: "image", mime: "image/jpeg", size: jpeg.length, filename: "test-shot.jpg" }),
  });
  assert.equal(presign.status, 200);
  const { key, putUrl } = await presign.json();

  // Unsigned access to the same key must fail both ways.
  const unsignedGet = await fetch(`${BASE}/api/storage/${key}`);
  assert.equal(unsignedGet.status, 403, "unsigned GET refused");
  const unsignedPut = await fetch(`${BASE}/api/storage/${key}`, { method: "PUT", body: jpeg });
  assert.equal(unsignedPut.status, 403, "unsigned PUT refused");

  // Signed upload + completion (server re-validates and generates variants).
  const put = await fetch(`${BASE}${putUrl}`, { method: "PUT", body: new Uint8Array(jpeg) });
  assert.equal(put.status, 201);
  const complete = await api("/api/assets/complete", {
    method: "POST",
    body: JSON.stringify({ key, mime: "image/jpeg", filename: "test-shot.jpg" }),
  });
  assert.equal(complete.status, 201);
  const { id: assetId, thumbUrl } = await complete.json();
  assert.ok(thumbUrl, "thumbnail variant generated");

  const thumb = await fetch(`${BASE}${thumbUrl}`);
  assert.equal(thumb.status, 200);
  assert.equal(thumb.headers.get("content-type"), "image/jpeg");

  const doubleComplete = await api("/api/assets/complete", {
    method: "POST",
    body: JSON.stringify({ key, mime: "image/jpeg", filename: "test-shot.jpg" }),
  });
  assert.equal(doubleComplete.status, 409, "completing the same key twice refused");

  const list = await (await api("/api/assets")).json();
  const listed = list.assets.find((a: { id: string }) => a.id === assetId);
  assert.ok(listed && listed.width === 1200 && listed.height === 900, "dimensions probed");

  // Attach to a scheduled post → delete must be refused while in use.
  const ig = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  const post = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "media attach test",
      accountIds: [ig!.id],
      assetIds: [assetId],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  assert.equal(post.status, 201);
  const { postId } = await post.json();
  const target = await db.postTarget.findFirst({ where: { postId } });
  assert.equal(target!.assetIds, assetId, "asset recorded on the target");

  const blockedDelete = await api(`/api/assets/${assetId}`, { method: "DELETE" });
  assert.equal(blockedDelete.status, 409, "in-use asset cannot be deleted");

  await api(`/api/targets/${target!.id}/cancel`, { method: "POST" });
  const del = await api(`/api/assets/${assetId}`, { method: "DELETE" });
  assert.equal(del.status, 200, "deletable once no longer scheduled");
  const goneThumb = await fetch(`${BASE}${thumbUrl}`);
  assert.equal(goneThumb.status, 404, "variant files removed");

  await db.post.delete({ where: { id: postId } });
});

test("orphan sweep deletes abandoned uploads, keeps completed assets", async () => {
  const { mkdir, writeFile, utimes, stat } = await import("fs/promises");
  const path = (await import("path")).default;
  const root = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "storage");

  // An abandoned upload: bytes on disk, no Asset row, older than the grace period.
  const orphanKey = "2020/01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg";
  const orphanAbs = path.join(root, orphanKey);
  await mkdir(path.dirname(orphanAbs), { recursive: true });
  await writeFile(orphanAbs, Buffer.from("abandoned bytes"));
  const old = new Date(Date.now() - 48 * 60 * 60_000);
  await utimes(orphanAbs, old, old);

  // A completed asset's file must survive even if old.
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } })
    .jpeg()
    .toBuffer();
  const presign = await api("/api/assets/presign", {
    method: "POST",
    body: JSON.stringify({ kind: "image", mime: "image/jpeg", size: jpeg.length, filename: "keeper.jpg" }),
  });
  const { key, putUrl } = await presign.json();
  await fetch(`${BASE}${putUrl}`, { method: "PUT", body: new Uint8Array(jpeg) });
  const complete = await api("/api/assets/complete", {
    method: "POST",
    body: JSON.stringify({ key, mime: "image/jpeg", filename: "keeper.jpg" }),
  });
  assert.equal(complete.status, 201);
  const { id: keeperId } = await complete.json();
  const keeperAbs = path.join(root, key);
  await utimes(keeperAbs, old, old);

  const { sweepOrphanUploads } = await import("../src/lib/server/sweep");
  const { deleted } = await sweepOrphanUploads();
  assert.ok(deleted >= 1, "orphan removed");
  await assert.rejects(stat(orphanAbs), "orphan file gone");
  await stat(keeperAbs); // completed asset survives

  await api(`/api/assets/${keeperId}`, { method: "DELETE" });
});

test("autopilot plans real scheduled posts and cleans up on off", async () => {
  const on = await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200);
  const { planned } = await on.json();
  // The plan targets instagram/tiktok/linkedin/x/instagram but only CONNECTED
  // platforms are used (no fallback piling onto one account) — so expected =
  // plan items whose platform is currently connected.
  const connectedPlatforms = new Set(
    (await db.socialAccount.findMany({ where: { status: "connected" }, select: { platform: true } })).map(
      (a) => a.platform,
    ),
  );
  const expected = ["instagram", "tiktok", "linkedin", "x", "instagram"].filter((p) =>
    connectedPlatforms.has(p),
  ).length;
  assert.equal(planned, expected, `planned ${planned}, expected ${expected} for connected platforms`);
  assert.ok(planned >= 1, "at least one platform should be connected in the test env");

  const apPosts = await db.post.count({ where: { source: "autopilot" } });
  assert.ok(apPosts >= planned, "autopilot posts exist");
  const apJobs = await db.publishJob.count({
    where: { completedAt: null, target: { post: { source: "autopilot" } } },
  });
  assert.ok(apJobs >= planned, "each planned post has a queued job");

  const off = await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  assert.equal(off.status, 200);
  const remaining = await db.post.count({
    where: { source: "autopilot", targets: { none: { state: { in: ["published", "publishing"] } } } },
  });
  assert.equal(remaining, 0, "unpublished autopilot posts removed");
});
