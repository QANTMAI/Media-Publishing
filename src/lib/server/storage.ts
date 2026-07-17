/* Object storage (Build Plan §03.1): files live in PRIVATE storage and are
 * reachable only through signed, expiring URLs — never through a public dir.
 *
 * This adapter is filesystem-backed for local dev; its contract (keys,
 * presigned PUT/GET, delete) mirrors S3 semantics so production swaps the
 * implementation, not the call sites. Signing is HMAC-SHA256 over
 * method·key·expiry with a dedicated key; URLs verify in constant time.
 *
 * The database never holds file bytes — only Asset metadata and storage keys
 * (see prisma/schema.prisma). */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";

const STORAGE_ROOT = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "storage");

function signingKey(): Buffer {
  const b64 = process.env.STORAGE_SIGNING_KEY;
  if (!b64) throw new Error("STORAGE_SIGNING_KEY is not configured");
  const key = Buffer.from(b64, "base64");
  if (key.length < 32) throw new Error("STORAGE_SIGNING_KEY must be at least 32 bytes (base64)");
  return key;
}

/** Keys are generated server-side — never client-supplied — so traversal is
 * impossible by construction; verification still re-checks. */
export function newStorageKey(ext: string): string {
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomBytes(16).toString("hex")}${safeExt ? "." + safeExt : ""}`;
}

function keyIsSafe(key: string): boolean {
  return /^[0-9]{4}\/[0-9]{2}\/[a-f0-9]{32}(\.[a-z0-9]{1,8})?(\.[a-z0-9_]{1,16}\.[a-z0-9]{1,8})?$/.test(key);
}

function sign(method: string, key: string, expires: number): string {
  return createHmac("sha256", signingKey()).update(`${method}\n${key}\n${expires}`).digest("hex");
}

/** Build a signed URL path for the storage route. TTL in seconds. */
export function presignUrl(method: "GET" | "PUT", key: string, ttlSeconds: number): string {
  if (!keyIsSafe(key)) throw new Error("Invalid storage key");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = sign(method, key, expires);
  return `/api/storage/${key}?exp=${expires}&sig=${sig}&m=${method}`;
}

/** Verify a signed request. Returns true only for an unexpired, untampered
 * signature matching this method+key. */
export function verifySignature(method: string, key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || !keyIsSafe(key)) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(method, key, expires), "hex");
  const given = Buffer.from(/^[a-f0-9]{64}$/.test(sig) ? sig : "0".repeat(64), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function storagePathFor(key: string): string {
  if (!keyIsSafe(key)) throw new Error("Invalid storage key");
  const abs = path.resolve(STORAGE_ROOT, key);
  if (!abs.startsWith(STORAGE_ROOT + path.sep)) throw new Error("Invalid storage key");
  return abs;
}

export async function putObject(key: string, data: Buffer): Promise<void> {
  const abs = storagePathFor(key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(storagePathFor(key));
  } catch {
    return null;
  }
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    return (await stat(storagePathFor(key))).size;
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await rm(storagePathFor(key), { force: true });
}
