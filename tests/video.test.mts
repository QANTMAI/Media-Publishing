/* Unit tests for the video pipeline's pure logic: ffmpeg argument
 * construction (researched encode plan) and platform spec validation
 * (researched limits). */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.STORAGE_SIGNING_KEY = process.env.STORAGE_SIGNING_KEY ?? Buffer.alloc(32, 3).toString("base64");
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./dev.db";

const { buildTranscodeArgs, buildCoverArgs, RENDITIONS } = await import("../src/lib/server/video");
const { validateVideoForPlatform, VIDEO_SPECS } = await import("../src/lib/video-specs");
const { PLATFORM_RULES } = await import("../src/lib/platforms");

test("transcode args: one invocation, all renditions, researched x264 settings", () => {
  const args = buildTranscodeArgs("/in.mp4", "/out", 30);
  const s = args.join(" ");
  // decode once, encode N (split fan-out)
  assert.match(s, /\[0:v\]split=4/);
  for (const r of RENDITIONS) assert.ok(s.includes(`/out/${r.name}.mp4`), `${r.name} output present`);
  // encode plan from research: veryfast + CRF 18 + high profile + yuv420p
  assert.ok(s.includes("-preset veryfast"));
  assert.ok(s.includes("-crf 18"));
  assert.ok(s.includes("-profile:v high"));
  assert.ok(s.includes("format=yuv420p"));
  // 2s closed GOP at 30fps => g=60, no scene-cut IDRs, faststart moov
  assert.ok(s.includes("-g 60"));
  assert.ok(s.includes("-keyint_min 60"));
  assert.ok(s.includes("-sc_threshold 0"));
  assert.ok(s.includes("-movflags +faststart"));
  // audio: native aac 192k 48kHz; tolerate silent sources
  assert.ok(s.includes("-c:a aac"));
  assert.ok(s.includes("-b:a 192k"));
  assert.ok(s.includes("-ar 48000"));
  assert.ok(s.includes("0:a?"));
});

test("transcode args: GOP follows source fps (2s closed GOP)", () => {
  assert.ok(buildTranscodeArgs("/in.mp4", "/out", 60).join(" ").includes("-g 120"));
  assert.ok(buildTranscodeArgs("/in.mp4", "/out", 24).join(" ").includes("-g 48"));
  // >60fps sources are capped at 60 out
  assert.ok(buildTranscodeArgs("/in.mp4", "/out", 120).join(" ").includes("-r 60"));
});

test("cover args: scene-aware thumbnail filter, fast+accurate seek before -i", () => {
  const args = buildCoverArgs("/in.mp4", "/cover.jpg");
  const ssIdx = args.indexOf("-ss");
  const inIdx = args.indexOf("-i");
  assert.ok(ssIdx >= 0 && ssIdx < inIdx, "-ss placed before -i");
  assert.match(args.join(" "), /thumbnail=n=\d+/);
  assert.ok(args.includes("-q:v"));
});

test("video specs: researched limits enforce correctly", () => {
  // X: 140s ceiling for tweet_video
  const tooLongForX = validateVideoForPlatform("x", {
    durationS: 200, width: 720, height: 1280, fps: 30, sizeMB: 50,
  });
  assert.ok(tooLongForX.some((p) => /exceeds the x maximum/i.test(p)), String(tooLongForX));
  // IG: 3s floor
  const tooShortForIg = validateVideoForPlatform("instagram", {
    durationS: 1, width: 1080, height: 1920, fps: 30, sizeMB: 10,
  });
  assert.ok(tooShortForIg.some((p) => /under the instagram minimum/i.test(p)));
  // X aspect bounds are 1:3–3:1
  const badAspect = validateVideoForPlatform("x", {
    durationS: 30, width: 4000, height: 1000, fps: 30, sizeMB: 50,
  });
  assert.ok(badAspect.some((p) => /aspect ratio/.test(p)));
  // A clean 9:16 60s clip passes everywhere relevant
  for (const platform of ["instagram", "x", "youtube", "tiktok", "facebook", "linkedin"]) {
    const problems = validateVideoForPlatform(platform, {
      durationS: 60, width: 1080, height: 1920, fps: 30, sizeMB: 40,
    });
    assert.deepEqual(problems, [], `${platform}: ${problems}`);
  }
});

test("video specs: every platform documents sources; unverified values flagged", () => {
  for (const [id, spec] of Object.entries(VIDEO_SPECS)) {
    assert.ok(spec.sources.length > 0, `${id} has source URLs`);
    assert.ok(spec.maxDurationS > spec.minDurationS, `${id} sane duration range`);
    assert.equal(typeof spec.verified, "boolean");
  }
  // The ones research could NOT fully confirm must stay flagged until re-verified.
  assert.equal(VIDEO_SPECS.facebook.verified, false);
  assert.equal(VIDEO_SPECS.linkedin.verified, false);
  assert.equal(VIDEO_SPECS.tiktok.verified, false);
});

test("SYSTEM RULE: composer video display derives from the enforced specs", () => {
  // docs/PLATFORM-RULES.md — display and enforcement share one source, so
  // the UI can never show a limit the API doesn't enforce.
  for (const [id, rules] of Object.entries(PLATFORM_RULES)) {
    const spec = VIDEO_SPECS[id];
    assert.ok(spec, `${id} has an enforced video spec`);
    const dur =
      spec.maxDurationS >= 3600
        ? `${Math.round(spec.maxDurationS / 3600)}h`
        : spec.maxDurationS >= 60
          ? `${Math.round(spec.maxDurationS / 60)}min`
          : `${spec.maxDurationS}s`;
    assert.ok(rules.vid.includes(dur), `${id} display "${rules.vid}" carries enforced duration ${dur}`);
    if (!spec.verified) {
      assert.ok(rules.vid.includes("unverified"), `${id} unverified spec is labeled in the UI`);
    }
  }
  // The audit's concrete contradictions can never return:
  assert.ok(PLATFORM_RULES.instagram.vid.includes("15min"), "IG shows the researched 15min, not the handoff's 90s");
  assert.ok(PLATFORM_RULES.linkedin.vid.includes("500MB"), "LinkedIn shows 500MB, not the handoff's 5GB");
});
