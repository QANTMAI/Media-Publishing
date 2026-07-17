/* Secrets vault (Build Plan §06): OAuth tokens encrypted at rest with
 * AES-256-GCM. Locally the master key comes from VAULT_MASTER_KEY; in
 * production this module is the seam where KMS envelope encryption plugs in
 * (encrypt the data key per secret, store the wrapped key alongside).
 *
 * Invariants: plaintext tokens are never logged, never returned to the client,
 * and only decrypted inside server-side publish/connect code paths. */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { db } from "./db";

const KEY_VERSION = 1;

function masterKey(): Buffer {
  const b64 = process.env.VAULT_MASTER_KEY;
  if (!b64) throw new Error("VAULT_MASTER_KEY is not configured");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("VAULT_MASTER_KEY must be 32 bytes (base64)");
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Store a token; returns the vault row id to keep on SocialAccount.tokenRef. */
export async function storeSecret(plaintext: string): Promise<string> {
  const row = await db.vaultSecret.create({
    data: { ciphertext: encrypt(plaintext), keyVersion: KEY_VERSION },
  });
  return row.id;
}

export async function readSecret(id: string): Promise<string | null> {
  const row = await db.vaultSecret.findUnique({ where: { id } });
  return row ? decrypt(row.ciphertext) : null;
}

export async function deleteSecret(id: string): Promise<void> {
  await db.vaultSecret.delete({ where: { id } }).catch(() => {
    // already gone — deletion is idempotent
  });
}
