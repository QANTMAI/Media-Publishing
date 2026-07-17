/* Unit tests for the storage adapter: HMAC URL signing (expiry, tamper,
 * method binding), server-generated keys, path-traversal safety, and the
 * object round-trip. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.STORAGE_SIGNING_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "qantm-storage-test-"));

const { newStorageKey, presignUrl, verifySignature, putObject, getObject, deleteObject, storagePathFor } =
  await import("../src/lib/server/storage");

function parts(url: string) {
  const u = new URL("http://x" + url);
  return {
    key: u.pathname.replace("/api/storage/", ""),
    exp: u.searchParams.get("exp"),
    sig: u.searchParams.get("sig"),
  };
}

test("signed GET verifies; wrong method / tampered sig / expired all fail", () => {
  const key = newStorageKey("jpg");
  const { key: k, exp, sig } = parts(presignUrl("GET", key, 60));
  assert.equal(k, key);
  assert.ok(verifySignature("GET", key, exp, sig), "valid signature verifies");
  assert.ok(!verifySignature("PUT", key, exp, sig), "method is bound into the signature");
  assert.ok(!verifySignature("GET", key, exp, sig!.replace(/^./, sig![0] === "a" ? "b" : "a")), "tamper fails");
  assert.ok(!verifySignature("GET", key, String(Math.floor(Date.now() / 1000) - 10), sig), "expiry is signed");
});

test("expired URLs are rejected", () => {
  const key = newStorageKey("png");
  const url = presignUrl("GET", key, -10); // already expired
  const { exp, sig } = parts(url);
  assert.ok(!verifySignature("GET", key, exp, sig));
});

test("keys are server-generated and safe; traversal is impossible", () => {
  const key = newStorageKey("jpg");
  assert.match(key, /^\d{4}\/\d{2}\/[a-f0-9]{32}\.jpg$/);
  assert.throws(() => presignUrl("GET", "../../etc/passwd", 60));
  assert.throws(() => storagePathFor("../../etc/passwd"));
  assert.throws(() => storagePathFor("2026/07/../../../x.jpg"));
  // variant keys derived from originals are accepted
  assert.ok(verifySignature("GET", ...(() => {
    const vk = `${key}.portrait.jpg`;
    const { exp, sig } = parts(presignUrl("GET", vk, 60));
    return [vk, exp, sig] as const;
  })()));
});

test("object round-trip and delete", async () => {
  const key = newStorageKey("bin");
  const data = Buffer.from("media bytes");
  await putObject(key, data);
  assert.deepEqual(await getObject(key), data);
  await deleteObject(key);
  assert.equal(await getObject(key), null);
});
