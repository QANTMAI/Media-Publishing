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

  // Self-provision the account fixtures the tests use, so the suite stays
  // green even after the operator Removes all seeded/mock accounts in the UI.
  // Upserts by (platform, externalId) — no duplicates, no dependence on seeds.
  const { storeSecret } = await import("../src/lib/server/vault");
  const igFixture = await db.socialAccount.findUnique({
    where: { platform_externalId: { platform: "instagram", externalId: "fixture_ig" } },
  });
  const anyMockIg = await db.socialAccount.findFirst({
    where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
  });
  if (!anyMockIg) {
    const tokenRef = igFixture?.tokenRef ?? (await storeSecret("mock-token-fixture_ig"));
    await db.socialAccount.upsert({
      where: { platform_externalId: { platform: "instagram", externalId: "fixture_ig" } },
      update: { status: "connected", tokenRef },
      create: {
        userId, platform: "instagram", externalId: "fixture_ig", name: "Instagram",
        mark: "IG", handle: "@fixture.test", label: "test fixture", status: "connected", tokenRef,
      },
    });
  }
  const anyYt = await db.socialAccount.findFirst({ where: { platform: "youtube" } });
  if (!anyYt) {
    // No token on purpose: tests use it for the honest permanent-failure path.
    await db.socialAccount.create({
      data: {
        userId, platform: "youtube", externalId: "fixture_yt", name: "YouTube",
        mark: "YT", handle: "Fixture Channel", label: "test fixture", status: "connected",
      },
    });
  }
  const anyX = await db.socialAccount.findFirst({ where: { platform: "x", status: "connected" } });
  if (!anyX) {
    // No token on purpose: used for composer validation (280-char limit).
    await db.socialAccount.create({
      data: {
        userId, platform: "x", externalId: "fixture_x", name: "X",
        mark: "X", handle: "@fixture_x", label: "test fixture", status: "connected",
      },
    });
  }

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

test("GET /api/posts returns targets with account joins", async () => {
  // Self-sufficient: create a post through the API, then assert the listing
  // shape includes it (no dependence on seeded demo data). The listing is
  // windowed (−90d…+365d), so schedule inside it: 7 days from now.
  const ig = await db.socialAccount.findFirst({ where: { platform: "instagram", status: "connected" } });
  const inWindow = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const created = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "listing shape test", accountIds: [ig!.id], date: inWindow, time: "10:00", tz: "UTC" }),
  });
  assert.equal(created.status, 201);
  const { postId } = await created.json();

  try {
    const res = await api("/api/posts");
    assert.equal(res.status, 200);
    const { targets } = await res.json();
    assert.ok(Array.isArray(targets) && targets.length > 0, "expected at least the post just created");
    const t = targets.find((x: { postId: string }) => x.postId === postId) ?? targets[0];
    assert.ok(t.id && t.caption && t.account?.mark, "target shape");
  } finally {
    // Cleanup must survive assertion failures, or reruns accumulate posts.
    await db.post.delete({ where: { id: postId } }).catch(() => {});
  }
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
  // Self-sufficient: if no published target exists (clean DB), create one
  // through the real pipeline — mock-token publish via a worker cycle.
  let target = await db.postTarget.findFirst({ where: { state: "published" } });
  let createdPostId: string | null = null;
  if (!target) {
    const ig = await db.socialAccount.findFirst({
      where: { platform: "instagram", status: "connected", tokenRef: { not: null } },
    });
    const created = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ baseCaption: "metrics fixture post", accountIds: [ig!.id], date: "2030-01-01", time: "10:00", tz: "UTC" }),
    });
    assert.equal(created.status, 201);
    createdPostId = (await created.json()).postId;
    const t = await db.postTarget.findFirst({ where: { postId: createdPostId! } });
    await db.publishJob.updateMany({ where: { postTargetId: t!.id }, data: { runAt: new Date(Date.now() - 1000) } });
    const { runQueueCycle } = await import("../src/lib/server/worker");
    await runQueueCycle();
    target = await db.postTarget.findFirst({ where: { id: t!.id, state: "published" } });
  }
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
    if (createdPostId) await db.post.delete({ where: { id: createdPostId } }).catch(() => {});
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

test("notifications: real publish failure notifies; prefs gate; review-ready; email honest", async () => {
  const { runQueueCycle } = await import("../src/lib/server/worker");
  // Clean slate for this operator's notifications.
  await db.notification.deleteMany({ where: { userId } });

  // Email is honestly reported as unconfigured in this env, and off by default.
  const prefs0 = await (await api("/api/notifications/prefs")).json();
  assert.equal(prefs0.emailConfigured, false, "no SMTP configured in test env");
  assert.equal(prefs0.prefs.email, false);
  assert.ok(prefs0.types.some((t: { key: string }) => t.key === "publish_failed"));

  // A real permanent failure (no-token account) must create a publish_failed notification.
  const yt = await db.socialAccount.findFirst({ where: { platform: "youtube" } });
  const mk = async () => {
    const res = await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ baseCaption: "notify fail test", accountIds: [yt!.id], date: "2030-01-01", time: "10:00", tz: "UTC" }),
    });
    const { postId } = await res.json();
    const t = await db.postTarget.findFirst({ where: { postId } });
    await db.publishJob.updateMany({ where: { postTargetId: t!.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await runQueueCycle();
    return { postId, targetId: t!.id };
  };
  const first = await mk();
  const failNote = await db.notification.findFirst({ where: { userId, type: "publish_failed" }, orderBy: { createdAt: "desc" } });
  assert.ok(failNote, "a publish_failed notification was created");
  assert.ok((failNote!.metadata ?? "").includes(first.targetId), "notification references the failed target");
  assert.equal(failNote!.emailedAt, null, "no email sent when unconfigured");

  // Masked API view + unread count + mark-read.
  const list1 = await (await api("/api/notifications")).json();
  assert.ok(list1.unread >= 1);
  assert.ok(list1.notifications.some((n: { id: string }) => n.id === failNote!.id));
  const read = await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ id: failNote!.id }) });
  assert.equal((await read.json()).count, 1);
  const list2 = await (await api("/api/notifications")).json();
  assert.equal(list2.unread, list1.unread - 1, "unread dropped after mark-read");

  // Turning a type OFF suppresses it: a new failure creates no new publish_failed row.
  await api("/api/notifications/prefs", { method: "PUT", body: JSON.stringify({ types: { publish_failed: false } }) });
  const beforeCount = await db.notification.count({ where: { userId, type: "publish_failed" } });
  const second = await mk();
  const afterCount = await db.notification.count({ where: { userId, type: "publish_failed" } });
  assert.equal(afterCount, beforeCount, "disabled type is suppressed");
  await api("/api/notifications/prefs", { method: "PUT", body: JSON.stringify({ types: { publish_failed: true } }) });

  // Review-mode autopilot creates a review_ready notification.
  await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autopilotMode: "review" }) });
  const on = await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: true }) });
  if ((await on.json()).planned > 0) {
    const reviewNote = await db.notification.findFirst({ where: { userId, type: "review_ready" } });
    assert.ok(reviewNote, "review_ready notification created");
  }

  // mark-all-read clears unread.
  await api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) });
  assert.equal((await (await api("/api/notifications")).json()).unread, 0);

  // Cleanup.
  await api("/api/autopilot", { method: "POST", body: JSON.stringify({ on: false }) });
  await db.post.deleteMany({ where: { source: "autopilot" } });
  await db.post.deleteMany({ where: { id: { in: [first.postId, second.postId] } } });
  await db.notification.deleteMany({ where: { userId } });
});

test("feeds: real RSS/Atom parsing, SSRF guard, and enabled-source listing", async () => {
  const { parseFeed } = await import("../src/lib/server/feeds");

  // Real RSS 2.0 parsing (entities decoded, HTML stripped, date parsed).
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>My Blog</title>
    <item><title>First &amp; best</title><link>https://ex.com/1</link><guid>g1</guid>
    <pubDate>Wed, 01 Jan 2025 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello world&lt;/p&gt;</description></item>
    </channel></rss>`;
  const p = parseFeed(rss);
  assert.equal(p.title, "My Blog");
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].title, "First & best");
  assert.equal(p.items[0].link, "https://ex.com/1");
  assert.equal(p.items[0].guid, "g1");
  assert.equal(p.items[0].summary, "Hello world");
  assert.ok(p.items[0].publishedAt instanceof Date);

  // Real Atom parsing (link@href with rel=alternate, id as guid).
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Site</title>
    <entry><title>Entry one</title><link href="https://ex.com/a" rel="alternate"/><id>id-a</id>
    <updated>2025-02-02T08:00:00Z</updated><summary>Sum</summary></entry></feed>`;
  const a = parseFeed(atom);
  assert.equal(a.title, "Atom Site");
  assert.equal(a.items[0].link, "https://ex.com/a");
  assert.equal(a.items[0].guid, "id-a");

  // Non-feed XML is rejected.
  assert.throws(() => parseFeed("<html><body>nope</body></html>"));

  // SSRF/validation guards reject unsafe URLs before any fetch.
  assert.equal((await api("/api/feeds", { method: "POST", body: JSON.stringify({ url: "ftp://ex.com/feed" }) })).status, 422);
  assert.equal((await api("/api/feeds", { method: "POST", body: JSON.stringify({ url: "http://127.0.0.1/feed" }) })).status, 422);
  assert.equal((await api("/api/feeds", { method: "POST", body: JSON.stringify({ url: "http://localhost:3000/feed" }) })).status, 422);
  assert.equal((await api("/api/feeds", { method: "POST", body: JSON.stringify({ url: "" }) })).status, 400);

  // DB-backed listing: seed a source + items, verify shaping + enabled filter.
  await db.feedSource.deleteMany({ where: { userId, url: "https://example.com/rss-test" } });
  const src = await db.feedSource.create({ data: { userId, url: "https://example.com/rss-test", title: "Test Feed", enabled: true } });
  await db.feedItem.createMany({
    data: [
      { sourceId: src.id, guid: "x1", title: "Item X1", link: "https://example.com/x1", publishedAt: new Date() },
      { sourceId: src.id, guid: "x2", title: "Item X2", link: "https://example.com/x2", publishedAt: new Date(Date.now() - 1000) },
    ],
  });
  const list = await (await api("/api/feeds")).json();
  assert.ok(list.sources.some((s: { id: string; itemCount: number }) => s.id === src.id && s.itemCount === 2));
  assert.ok(list.items.some((i: { title: string; sourceTitle: string }) => i.title === "Item X1" && i.sourceTitle === "Test Feed"));

  // Disabling a source hides its items but keeps the source.
  assert.equal((await api(`/api/feeds/${src.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) })).status, 200);
  const list2 = await (await api("/api/feeds")).json();
  assert.ok(list2.sources.some((s: { id: string }) => s.id === src.id), "disabled source still listed");
  assert.ok(!list2.items.some((i: { title: string }) => i.title === "Item X1"), "disabled source items hidden");

  // Delete cascades items; unknown id 404s.
  assert.equal((await api(`/api/feeds/${src.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await api(`/api/feeds/nope`, { method: "DELETE" })).status, 404);
  assert.equal(await db.feedItem.count({ where: { sourceId: src.id } }), 0, "items cascade-deleted");
});

test("production hardening: config guard, WAL mode, and health probe", async () => {
  const { checkConfig } = await import("../src/lib/server/config");
  const b64_32 = Buffer.alloc(32).toString("base64");
  const okProd = {
    NODE_ENV: "production",
    SESSION_SECRET: "s".repeat(40),
    VAULT_MASTER_KEY: b64_32,
    STORAGE_SIGNING_KEY: Buffer.alloc(48).toString("base64"),
    DATABASE_URL: "file:/data/prod.db",
    PUBLIC_ORIGIN: "https://portal.example.com",
    OAUTH_MOCK: "1",
  };

  // A well-formed production (mock) config has no errors.
  assert.deepEqual(checkConfig(okProd).errors, []);

  // Missing critical secrets are ERRORS in production.
  const bare = checkConfig({ NODE_ENV: "production" });
  for (const re of [/SESSION_SECRET/, /VAULT_MASTER_KEY/, /STORAGE_SIGNING_KEY/, /PUBLIC_ORIGIN/]) {
    assert.ok(bare.errors.some((e: string) => re.test(e)), `expected prod error ${re}`);
  }

  // Dev auth-bypass left on in prod is a hard error.
  assert.ok(checkConfig({ ...okProd, AUTH_DEV_BYPASS: "1" }).errors.some((e: string) => /AUTH_DEV_BYPASS/.test(e)));

  // Weak values are caught.
  assert.ok(checkConfig({ ...okProd, VAULT_MASTER_KEY: Buffer.alloc(16).toString("base64") }).errors.some((e: string) => /VAULT_MASTER_KEY must be exactly 32/.test(e)));
  assert.ok(checkConfig({ ...okProd, PUBLIC_ORIGIN: "http://insecure" }).errors.some((e: string) => /PUBLIC_ORIGIN must be an https/.test(e)));

  // Real OAuth mode with a fully-absent platform app: loud warning (the
  // platform falls back to labeled mock connects); PARTIAL config: hard error.
  assert.ok(checkConfig({ ...okProd, OAUTH_MOCK: "0" }).warnings.some((w: string) => /META_\* is unset/.test(w)));
  assert.ok(checkConfig({ ...okProd, META_APP_ID: "123" }).errors.some((e: string) => /Meta OAuth is partially configured/.test(e)));

  // Development is lenient: missing SECRETS are warnings, not errors (only a
  // truly absent DATABASE_URL is fatal, so provide it here).
  const dev = checkConfig({ NODE_ENV: "development", DATABASE_URL: "file:./dev.db" });
  assert.equal(dev.errors.length, 0, "dev never blocks the boot on missing secrets");
  assert.ok(dev.warnings.some((w: string) => /SESSION_SECRET|VAULT_MASTER_KEY/.test(w)));
  // DATABASE_URL is required even in dev.
  assert.ok(checkConfig({ NODE_ENV: "development" }).errors.some((e: string) => /DATABASE_URL/.test(e)));

  // SQLite is in WAL mode (set at boot; required for Litestream + concurrency).
  const jm = (await db.$queryRawUnsafe("PRAGMA journal_mode")) as Array<{ journal_mode: string }>;
  assert.equal(jm[0].journal_mode.toLowerCase(), "wal", "database runs in WAL mode");

  // Health probe is unauthenticated, secret-free, and reports DB reachability.
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
  const hb = await health.json();
  assert.equal(hb.status, "ok");
  assert.equal(hb.db, true);
  assert.ok(["mock", "live"].includes(hb.publishing));
  assert.equal(typeof hb.email, "boolean");
});

test("Remove account: purge deletes row, cascades posts, sweeps orphans, wipes vault token", async () => {
  const { storeSecret } = await import("../src/lib/server/vault");

  // Idempotency: clear residue from any earlier (failed) run first.
  for (const platform of ["pinterest", "tiktok"]) {
    const stale = await db.socialAccount.findUnique({
      where: { platform_externalId: { platform, externalId: "purge_test_1" } },
    });
    if (stale) {
      await db.socialAccount.delete({ where: { id: stale.id } });
      await db.post.deleteMany({ where: { userId, targets: { none: {} } } });
    }
  }

  // Build a disposable account with a vault token and one scheduled post.
  // Platform must be composer-supported (MARK_TO_PLATFORM) or POST /api/posts
  // rightly rejects the target with 422 — TikTok is supported.
  const tokenRef = await storeSecret("mock-token-purge_test");
  const acct = await db.socialAccount.create({
    data: {
      userId, platform: "tiktok", externalId: "purge_test_1", name: "TikTok",
      mark: "TT", handle: "@purge-test", label: "test fixture", status: "connected", tokenRef,
    },
  });
  const created = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "purge cascade test", accountIds: [acct.id], date: "2030-04-01", time: "10:00", tz: "UTC" }),
  });
  assert.equal(created.status, 201);
  const { postId } = await created.json();

  // Plain DELETE (no purge) must still only disconnect — row survives.
  const disc = await api(`/api/accounts/${acct.id}`, { method: "DELETE" });
  assert.equal(disc.status, 200);
  assert.ok(await db.socialAccount.findUnique({ where: { id: acct.id } }), "disconnect keeps the row");

  // Purge: row gone, targets cascaded, orphaned post swept, vault secret gone.
  const purge = await api(`/api/accounts/${acct.id}?purge=1`, { method: "DELETE" });
  assert.equal(purge.status, 200);
  const body = await purge.json();
  assert.equal(body.removed, true);
  assert.equal(body.removedTargets, 1);
  assert.equal(body.removedPosts, 1, "orphaned post swept with the account");
  assert.equal(await db.socialAccount.findUnique({ where: { id: acct.id } }), null, "row deleted");
  assert.equal(await db.post.findUnique({ where: { id: postId } }), null, "post gone");
  assert.equal(await db.vaultSecret.findUnique({ where: { id: tokenRef } }), null, "vault token wiped");

  // Purging a nonexistent id 404s; the audit trail recorded the removal.
  assert.equal((await api(`/api/accounts/${acct.id}?purge=1`, { method: "DELETE" })).status, 404);
  const auditRow = await db.auditEvent.findFirst({ where: { action: "account.remove" }, orderBy: { createdAt: "desc" } });
  assert.ok(auditRow && (auditRow.metadata ?? "").includes("purge-test"), "account.remove audited");
});

test("vault sweep: deletes only old unreferenced ciphertext; keeps referenced + recent", async () => {
  const { storeSecret } = await import("../src/lib/server/vault");
  const { sweepOrphanVaultSecrets } = await import("../src/lib/server/sweep");

  // Three secrets: an OLD orphan (dead ciphertext), a FRESH orphan (simulates
  // an in-flight OAuth callback), and one REFERENCED by an account.
  const oldOrphan = await storeSecret("mock-token-sweep_old");
  await db.vaultSecret.update({ where: { id: oldOrphan }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
  const freshOrphan = await storeSecret("mock-token-sweep_fresh");
  const referenced = await storeSecret("mock-token-sweep_ref");
  await db.vaultSecret.update({ where: { id: referenced }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60_000) } });
  const acct = await db.socialAccount.upsert({
    where: { platform_externalId: { platform: "threads", externalId: "sweep_ref_1" } },
    update: { tokenRef: referenced },
    create: {
      userId, platform: "threads", externalId: "sweep_ref_1", name: "Threads",
      mark: "TH", handle: "@sweep-ref", label: "test fixture", status: "connected", tokenRef: referenced,
    },
  });

  const { deleted } = await sweepOrphanVaultSecrets();
  assert.ok(deleted >= 1, "swept at least the old orphan");
  assert.equal(await db.vaultSecret.findUnique({ where: { id: oldOrphan } }), null, "old orphan gone");
  assert.ok(await db.vaultSecret.findUnique({ where: { id: freshOrphan } }), "fresh orphan survives the grace period");
  assert.ok(await db.vaultSecret.findUnique({ where: { id: referenced } }), "referenced secret untouched");

  // Cleanup: purge the fixture account via the real endpoint (also removes its
  // secret), then drop the fresh orphan directly.
  const purge = await api(`/api/accounts/${acct.id}?purge=1`, { method: "DELETE" });
  assert.equal(purge.status, 200);
  assert.equal(await db.vaultSecret.findUnique({ where: { id: referenced } }), null, "purge wiped the referenced secret");
  await db.vaultSecret.delete({ where: { id: freshOrphan } });
});

test("linkedin: little-text escaping, documented post body, error classification", async () => {
  const { escapeLittleText, buildLinkedInPostBody, classifyLinkedInError } = await import("../src/lib/server/linkedin");
  const { PermanentError } = await import("../src/lib/server/publisher-errors");

  // Reserved little-format chars are escaped; # stays (real hashtags work).
  assert.equal(escapeLittleText("Sale (20% off) [today] #deal"), "Sale \\(20% off\\) \\[today\\] #deal");
  assert.equal(escapeLittleText("a@b {x} <y> *bold* _u_ ~s~ | \\"), "a\\@b \\{x\\} \\<y\\> \\*bold\\* \\_u\\_ \\~s\\~ \\| \\\\");
  assert.equal(escapeLittleText("plain text #tag stays"), "plain text #tag stays");

  // Exact minimal body per the Posts API doc (li-lms-2026-06).
  const body = buildLinkedInPostBody("AbC123", "hello (world)");
  assert.deepEqual(body, {
    author: "urn:li:person:AbC123",
    commentary: "hello \\(world\\)",
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  });

  // Error classification per the documented table.
  for (const s of [400, 401, 403, 404, 422]) {
    assert.ok(classifyLinkedInError(s, "x") instanceof PermanentError, `${s} must be permanent`);
  }
  for (const s of [409, 429, 500, 503]) {
    assert.ok(!(classifyLinkedInError(s, "x") instanceof PermanentError), `${s} must be retryable`);
  }
  assert.match(classifyLinkedInError(401, "expired").message, /reconnect/i);

  // Config guard: partial LINKEDIN_* is a hard error in production.
  const { checkConfig } = await import("../src/lib/server/config");
  const partial = checkConfig({ NODE_ENV: "production", DATABASE_URL: "file:x", LINKEDIN_CLIENT_ID: "abc" });
  assert.ok(partial.errors.some((e: string) => /LinkedIn OAuth is partially configured/.test(e)));
});

test("linkedin: mock OAuth connect creates labeled account; queue publishes to labeled mock permalink", async () => {
  const { runQueueCycle } = await import("../src/lib/server/worker");

  // Start: requires auth, sets the state cookie, and (mock mode) redirects to
  // the callback carrying the same state.
  const start = await api("/api/oauth/linkedin/start");
  assert.ok([302, 307].includes(start.status), `start should redirect, got ${start.status}`);
  const loc = start.headers.get("location")!;
  assert.match(loc, /\/api\/oauth\/linkedin\/callback\?mock=1&state=/);
  const state = new URL(loc, BASE).searchParams.get("state")!;

  // Wrong state must be rejected (CSRF guard) BEFORE consuming the cookie…
  // (cookie is single-use, so run the real callback first, then test mismatch)
  const cb = await api(`/api/oauth/linkedin/callback?mock=1&state=${state}`);
  assert.ok([302, 307].includes(cb.status));
  assert.match(cb.headers.get("location") ?? "", /accounts\?connected=1/);

  const acct = await db.socialAccount.findUnique({
    where: { platform_externalId: { platform: "linkedin", externalId: "mock_li_1" } },
  });
  assert.ok(acct, "linkedin account row created");
  assert.equal(acct!.status, "connected");
  assert.equal(acct!.label, "mock connection", "honestly labeled as mock");
  assert.equal(acct!.scopes, "openid profile w_member_social", "real scopes recorded");
  assert.ok(acct!.tokenRef, "token stored in vault");

  // A stale/forged state now fails (no cookie present).
  const forged = await api(`/api/oauth/linkedin/callback?mock=1&state=deadbeef`);
  assert.match(forged.headers.get("location") ?? "", /connect_error=State\+mismatch|connect_error=State%20mismatch/);

  // Publish through the REAL queue: mock token → labeled mock permalink.
  const created = await api("/api/posts", {
    method: "POST",
    body: JSON.stringify({ baseCaption: "linkedin mock publish test", accountIds: [acct!.id], date: "2030-01-01", time: "10:00", tz: "UTC" }),
  });
  assert.equal(created.status, 201);
  const { postId } = await created.json();
  const t = await db.postTarget.findFirst({ where: { postId } });
  await db.publishJob.updateMany({ where: { postTargetId: t!.id }, data: { runAt: new Date(Date.now() - 1000) } });
  await runQueueCycle();
  const after = await db.postTarget.findUnique({ where: { id: t!.id } });
  assert.equal(after!.state, "published", after!.error ?? "");
  assert.match(after!.permalink ?? "", /mock\.qantm\.local\/linkedin\//, "labeled mock permalink, never a fake real link");

  // Cleanup: purge via the real endpoint (also wipes the vault token).
  await db.post.delete({ where: { id: postId } });
  const purge = await api(`/api/accounts/${acct!.id}?purge=1`, { method: "DELETE" });
  assert.equal(purge.status, 200);
});
