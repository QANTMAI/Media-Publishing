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

test("Save draft creates draft targets with NO publish job (handoff #2)", async () => {
  const ig = await db.socialAccount.findFirst({ where: { platform: "instagram", status: "connected" } });
  // Drafts accept a past time and never queue.
  const res = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "a saved draft",
      accountIds: [ig!.id],
      date: "2020-01-01",
      time: "10:00",
      tz: "UTC",
      draft: true,
    }),
  });
  assert.equal(res.status, 201, "draft with a past time is allowed");
  const { postId } = await res.json();
  const post = await db.post.findUnique({ where: { id: postId }, include: { targets: { include: { jobs: true } } } });
  assert.equal(post!.status, "draft");
  assert.equal(post!.targets[0].state, "draft");
  assert.equal(post!.targets[0].jobs.length, 0, "drafts get no publish job");
  await db.post.delete({ where: { id: postId } });
});

test("reassign a post's category (calendar dialog)", async () => {
  const ig = await db.socialAccount.findFirst({ where: { platform: "instagram", status: "connected" } });
  const res = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "recategorize me",
      category: "Promo",
      accountIds: [ig!.id],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  const { postId } = await res.json();
  const patch = await api(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ category: "News" }) });
  assert.equal(patch.status, 200);
  const post = await db.post.findUnique({ where: { id: postId } });
  assert.equal(post!.category, "News");
  // Empty category rejected.
  const bad = await api(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ category: "  " }) });
  assert.equal(bad.status, 400);
  await db.post.delete({ where: { id: postId } });
});

test("autopilot mode persists via /api/settings", async () => {
  const set = await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "auto" }) });
  assert.equal(set.status, 200);
  assert.equal((await set.json()).autopilotMode, "auto");
  const got = await (await api("/api/settings")).json();
  assert.equal(got.autopilotMode, "auto");
  // restore default
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "review" }) });
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

  // Cancelled posts drop to DRAFT — drafts still protect their media (a
  // relaunched draft must not lose its attachment), so delete stays refused
  // until the post itself is gone.
  await api(`/api/targets/${target!.id}/cancel`, { method: "POST" });
  const stillBlocked = await api(`/api/assets/${assetId}`, { method: "DELETE" });
  assert.equal(stillBlocked.status, 409, "drafts keep protecting their media");

  await db.post.delete({ where: { id: postId } });
  const del = await api(`/api/assets/${assetId}`, { method: "DELETE" });
  assert.equal(del.status, 200, "deletable once nothing references it");
  const goneThumb = await fetch(`${BASE}${thumbUrl}`);
  assert.equal(goneThumb.status, 404, "variant files removed");
});

test("video pipeline: upload → transcode renditions + cover → validate → Reels publish (mock)", async () => {
  // A REAL 4-second test video generated by the bundled ffmpeg (≥3s = IG floor).
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const path = (await import("path")).default;
  const { tmpdir } = await import("os");
  const { readFile, rm } = await import("fs/promises");
  const execFileP = promisify(execFile);
  const ffmpeg = (await import("ffmpeg-static")).default as string;

  const srcAbs = path.join(tmpdir(), `qantm-testvid-${Date.now()}.mp4`);
  await execFileP(ffmpeg, [
    "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", srcAbs,
  ]);
  const videoBytes = await readFile(srcAbs);
  await rm(srcAbs, { force: true });

  // Upload through the real API flow.
  const presign = await api("/api/assets/presign", {
    method: "POST",
    body: JSON.stringify({ kind: "video", mime: "video/mp4", size: videoBytes.length, filename: "clip.mp4" }),
  });
  assert.equal(presign.status, 200);
  const { key, putUrl } = await presign.json();
  const put = await fetch(`${BASE}${putUrl}`, { method: "PUT", body: new Uint8Array(videoBytes) });
  assert.equal(put.status, 201);
  const complete = await api("/api/assets/complete", {
    method: "POST",
    body: JSON.stringify({ key, mime: "video/mp4", filename: "clip.mp4" }),
  });
  assert.equal(complete.status, 201);
  const { id: assetId, status } = await complete.json();
  assert.equal(status, "processing", "videos start in processing");

  // Transcode: either this in-process call claims it, or the dev server's
  // media worker already did — the atomic claim guarantees exactly one runs.
  const { processNextVideo } = await import("../src/lib/server/video");
  await processNextVideo();
  const deadline = Date.now() + 120_000;
  let asset = await db.asset.findUnique({ where: { id: assetId } });
  while (asset!.status === "processing" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    asset = await db.asset.findUnique({ where: { id: assetId } });
  }
  assert.equal(asset!.status, "ready", `transcode outcome: ${asset!.status} ${asset!.error ?? ""}`);
  assert.ok(asset!.durationS! > 3.5 && asset!.durationS! < 4.5, `duration probed: ${asset!.durationS}`);
  assert.ok(asset!.coverKey, "cover frame stored");

  const variants = JSON.parse(asset!.variants!) as Record<string, string>;
  for (const name of ["vertical", "square", "landscape", "xvertical", "thumb"]) {
    assert.ok(variants[name], `${name} rendition present`);
  }

  // Verify the 9:16 rendition is genuinely 1080x1920 H.264 — probe the file.
  const { probeVideo } = await import("../src/lib/server/video");
  const { storagePathFor } = await import("../src/lib/server/storage");
  const vertical = await probeVideo(storagePathFor(variants.vertical));
  assert.equal(vertical.width, 1080);
  assert.equal(vertical.height, 1920);
  assert.equal(vertical.vcodec, "h264");

  // Spec validation: a 4s clip passes IG (3s floor) — schedule it as a Reel.
  const ig = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  const post = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      baseCaption: "video pipeline test reel",
      accountIds: [ig!.id],
      assetIds: [assetId],
      date: "2030-01-01",
      time: "10:00",
      tz: "UTC",
    }),
  });
  assert.equal(post.status, 201);
  const { postId } = await post.json();

  const targets = await db.postTarget.findMany({ where: { postId } });
  await db.publishJob.updateMany({
    where: { postTargetId: { in: targets.map((t) => t.id) } },
    data: { runAt: new Date(Date.now() - 1000) },
  });
  const { runQueueCycle } = await import("../src/lib/server/worker");
  await runQueueCycle();
  const published = await db.postTarget.findFirst({ where: { postId } });
  assert.equal(published!.state, "published", `reel publish: ${published!.state} ${published!.error ?? ""}`);

  // Cleanup.
  await db.post.delete({ where: { id: postId } });
  await api(`/api/assets/${assetId}`, { method: "DELETE" });
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

test("metrics: mock publishes get NO snapshots; /api/metrics serves only real rows", async () => {
  // The dev DB is full of mock-published targets (externalMediaId "mock_…").
  // A collection cycle must skip every one of them — no fabricated numbers.
  const { collectMetricsCycle } = await import("../src/lib/server/insights");
  const before = await db.metricSnapshot.count();
  const result = await collectMetricsCycle();
  assert.equal(result.pulled, 0, "no real-token targets exist → nothing pulled");
  assert.equal(await db.metricSnapshot.count(), before, "no snapshots fabricated for mock publishes");

  // The read path, exercised with an explicit test snapshot (cleaned up).
  const target = await db.postTarget.findFirst({ where: { state: "published" } });
  assert.ok(target, "need a published target");
  const snap = await db.metricSnapshot.create({
    data: {
      postTargetId: target!.id,
      views: 1200,
      reach: 950,
      likes: 60,
      comments: 8,
      shares: 3,
      saves: 5,
      raw: JSON.stringify({ test: "fixture — integration test row" }),
    },
  });
  try {
    const res = await api("/api/metrics");
    assert.equal(res.status, 200);
    const d = await res.json();
    const row = d.posts.find((p: { targetId: string }) => p.targetId === target!.id);
    assert.ok(row, "snapshot surfaces in /api/metrics");
    assert.equal(row.views, 1200);
    assert.equal(row.reach, 950);
    assert.equal(d.totals.views >= 1200, true, "totals aggregate");
  } finally {
    await db.metricSnapshot.delete({ where: { id: snap.id } });
  }

  const anon = await fetch(`${BASE}/api/metrics`);
  assert.equal(anon.status, 401, "metrics endpoint requires auth");
});

test("autopilot (auto mode) plans real scheduled posts and cleans up on off", async () => {
  // Ensure a clean OFF baseline — autopilot ON is idempotent, so a lingering
  // ON from prior use would return planned:0.
  await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  // Auto-schedule mode is what queues jobs directly (review mode drafts instead).
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "auto" }) });
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
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "review" }) });
});

test("autopilot (review mode) drafts for the inbox; approve queues, discard removes", async () => {
  await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "review" }) });
  const on = await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: true }) });
  assert.equal(on.status, 200);
  const body = await on.json();
  assert.equal(body.mode, "review");
  assert.ok(body.planned >= 1, "at least one review draft planned");

  // Review-mode plans are DRAFTS with no queue jobs — nothing publishes until approved.
  const drafts = await db.post.findMany({
    where: { source: "autopilot", status: "draft" },
    include: { targets: { include: { jobs: true } } },
  });
  assert.ok(drafts.length >= 1, "autopilot created draft posts");
  for (const d of drafts) {
    assert.equal(d.targets[0].state, "draft");
    assert.equal(d.targets[0].jobs.length, 0, "review drafts have no publish job");
  }

  // Approve one → it schedules and gets a real job.
  const toApprove = drafts[0];
  const appr = await api(`/api/posts/${toApprove.id}/approve`, { method: "POST" });
  assert.equal(appr.status, 200);
  const approved = await db.post.findUnique({
    where: { id: toApprove.id },
    include: { targets: { include: { jobs: true } } },
  });
  assert.equal(approved!.status, "scheduled");
  assert.equal(approved!.targets[0].state, "scheduled");
  assert.equal(approved!.targets[0].jobs.length, 1, "approved draft is queued");
  assert.ok(approved!.targets[0].jobs[0].runAt.getTime() > Date.now(), "job runs in the future");

  // Discard another → gone; and a scheduled post can't be discarded.
  if (drafts[1]) {
    const del = await api(`/api/posts/${drafts[1].id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(await db.post.count({ where: { id: drafts[1].id } }), 0, "discarded draft removed");
  }
  const cantDiscard = await api(`/api/posts/${toApprove.id}`, { method: "DELETE" });
  assert.equal(cantDiscard.status, 409, "scheduled posts can't be discarded");

  // Clean up: autopilot off removes remaining unpublished autopilot posts, but
  // the one we approved (now scheduled, with a job) also gets cleaned since no
  // target is published/publishing/claimed.
  await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  await db.post.deleteMany({ where: { source: "autopilot" } });
});

test("categories: defaults seed, create, rename relabels posts, recolor, delete guards last", async () => {
  // Defaults are seeded on first read.
  const list = await (await api("/api/categories")).json();
  assert.ok(list.categories.length >= 6, "default categories seeded");
  assert.ok(list.categories.some((c: { name: string }) => c.name === "Promo"), "Promo default present");

  // Create — unique name enforced.
  const created = await api("/api/categories", { method: "POST", body: JSON.stringify({ name: "Test Cat", color: "#123456" }) });
  assert.equal(created.status, 201);
  const cat = await created.json();
  assert.equal(cat.color, "#123456");
  const dup = await api("/api/categories", { method: "POST", body: JSON.stringify({ name: "Test Cat" }) });
  assert.equal(dup.status, 409, "duplicate name rejected");

  // A post using the category follows a rename.
  const ig = await db.socialAccount.findFirst({ where: { platform: "instagram", status: "connected" } });
  const postRes = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "cat rename test", category: "Test Cat", accountIds: [ig!.id], date: "2030-02-01", time: "10:00", tz: "UTC" }),
  });
  const { postId } = await postRes.json();
  const renamed = await api(`/api/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed Cat" }) });
  assert.equal(renamed.status, 200);
  assert.equal((await db.post.findUnique({ where: { id: postId } }))!.category, "Renamed Cat", "rename relabels existing posts");

  // Recolor.
  const recolor = await api(`/api/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ color: "#abcdef" }) });
  assert.equal(recolor.status, 200);
  assert.equal((await db.category.findUnique({ where: { id: cat.id } }))!.color, "#abcdef");
  // Bad hex rejected.
  const badColor = await api(`/api/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ color: "red" }) });
  assert.equal(badColor.status, 400);

  // Delete — post keeps its (now-orphaned) category name, nothing cascades.
  const del = await api(`/api/categories/${cat.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal((await db.post.findUnique({ where: { id: postId } }))!.category, "Renamed Cat", "post history intact after delete");
  await db.post.delete({ where: { id: postId } });

  // Can't delete the last category.
  const all = await db.category.findMany({ where: { userId } });
  const extras = all.slice(1);
  // Temporarily remove all but one, assert the last is protected, then restore.
  for (const c of extras) await db.category.delete({ where: { id: c.id } });
  const guarded = await api(`/api/categories/${all[0].id}`, { method: "DELETE" });
  assert.equal(guarded.status, 409, "last category is protected");
  // Restore defaults for other tests / the app.
  for (const c of extras) {
    await db.category.create({ data: { userId, name: c.name, color: c.color, hashtags: c.hashtags, sortOrder: c.sortOrder } });
  }
});

test("credentials: keys are stored encrypted, returned only masked, and deletable", async () => {
  // Clean slate for the anthropic provider.
  await db.credential.deleteMany({ where: { userId, provider: "anthropic" } });

  // Unset provider reports set:false and no hint; OpenAI is never offered.
  const before = await (await api("/api/credentials")).json();
  const anth = before.credentials.find((c: { provider: string }) => c.provider === "anthropic");
  assert.ok(anth, "anthropic provider is listed");
  assert.equal(anth.set, false);
  assert.equal(anth.hint, null);
  assert.ok(!before.credentials.some((c: { provider: string }) => c.provider === "openai"), "OpenAI is never a provider");

  // Testing with no key saved short-circuits (no network call).
  const noKey = await (await api("/api/credentials/anthropic/test", { method: "POST" })).json();
  assert.equal(noKey.ok, false);
  assert.match(noKey.status, /no key/i);

  // Validation: empty / whitespace / too-short / unknown-provider all rejected.
  assert.equal((await api("/api/credentials/anthropic", { method: "PUT", body: JSON.stringify({ key: "" }) })).status, 400);
  assert.equal((await api("/api/credentials/anthropic", { method: "PUT", body: JSON.stringify({ key: "has space" }) })).status, 400);
  assert.equal((await api("/api/credentials/anthropic", { method: "PUT", body: JSON.stringify({ key: "short" }) })).status, 400);
  assert.equal((await api("/api/credentials/nope", { method: "PUT", body: JSON.stringify({ key: "sk-ant-whatever-1234" }) })).status, 404);

  // Store a (bogus) key — never live-tested here to avoid a network call.
  const secret = "sk-ant-test-DO-NOT-USE-abcd";
  const put = await api("/api/credentials/anthropic", { method: "PUT", body: JSON.stringify({ key: secret }) });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.hint, "abcd", "response carries only the last-4 hint");
  assert.ok(!JSON.stringify(putBody).includes(secret), "the key is never echoed back");

  // Masked view: set:true + hint, and crucially no ciphertext / key anywhere.
  const after = await (await api("/api/credentials")).json();
  const set = after.credentials.find((c: { provider: string }) => c.provider === "anthropic");
  assert.equal(set.set, true);
  assert.equal(set.hint, "abcd");
  assert.ok(!JSON.stringify(after).includes(secret), "GET never leaks the key");
  assert.ok(!JSON.stringify(after).toLowerCase().includes("ciphertext"), "GET never leaks ciphertext");

  // At rest it's encrypted, not plaintext.
  const row = await db.credential.findUnique({ where: { userId_provider: { userId, provider: "anthropic" } } });
  assert.ok(row && row.ciphertext && !row.ciphertext.includes(secret), "stored value is encrypted, not plaintext");
  assert.equal(row!.lastTestOk, null, "a fresh key has no stale test result");

  // Delete → gone; deleting again 404s.
  assert.equal((await api("/api/credentials/anthropic", { method: "DELETE" })).status, 200);
  const gone = await (await api("/api/credentials")).json();
  assert.equal(gone.credentials.find((c: { provider: string }) => c.provider === "anthropic").set, false);
  assert.equal((await api("/api/credentials/anthropic", { method: "DELETE" })).status, 404);
});
