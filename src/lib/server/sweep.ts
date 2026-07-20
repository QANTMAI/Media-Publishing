/* Orphan sweep: a client can presign and upload bytes but never call
 * complete — those files have no Asset row and would otherwise sit on disk
 * forever. The worker runs this hourly: any stored file older than 24h whose
 * key isn't referenced by an Asset (original or variant) is deleted.
 *
 * The 24h grace period makes racing a legitimate in-flight upload impossible
 * (presigned PUT URLs live 10 minutes). */

import { readdir, stat, rm } from "fs/promises";
import path from "path";
import { db } from "./db";
import { variantKeys } from "./media";

const GRACE_MS = 24 * 60 * 60_000;

export async function sweepOrphanUploads(): Promise<{ deleted: number }> {
  const root = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? "storage");

  let entries: string[];
  try {
    entries = (await readdir(root, { recursive: true })) as string[];
  } catch {
    return { deleted: 0 }; // storage dir doesn't exist yet
  }

  const assets = await db.asset.findMany({ select: { storageKey: true, variants: true, coverKey: true } });
  const known = new Set<string>();
  for (const a of assets) {
    known.add(a.storageKey);
    if (a.coverKey) known.add(a.coverKey); // video cover frames live on the row, not in variants
    for (const k of variantKeys(a.variants)) known.add(k);
  }

  const cutoff = Date.now() - GRACE_MS;
  let deleted = 0;
  for (const entry of entries) {
    const key = entry.split(path.sep).join("/");
    if (known.has(key)) continue;
    const abs = path.join(root, entry);
    try {
      const s = await stat(abs);
      if (!s.isFile() || s.mtimeMs > cutoff) continue;
      await rm(abs, { force: true });
      deleted += 1;
    } catch {
      // raced or already gone — fine
    }
  }
  if (deleted > 0) console.log(`[sweep] removed ${deleted} orphaned upload file(s)`);
  return { deleted };
}

/** Vault hygiene: delete VaultSecret rows nothing references. The only
 * referencer is SocialAccount.tokenRef (Credential stores its ciphertext
 * inline), so anything unreferenced is dead ciphertext — from a crashed
 * connect flow or direct test writes. A 1h grace period protects rows created
 * moments ago by an in-flight OAuth callback that hasn't linked them yet. */
export async function sweepOrphanVaultSecrets(): Promise<{ deleted: number }> {
  const keep = (
    await db.socialAccount.findMany({ where: { tokenRef: { not: null } }, select: { tokenRef: true } })
  ).map((a) => a.tokenRef as string);
  const res = await db.vaultSecret.deleteMany({
    where: { id: { notIn: keep }, createdAt: { lt: new Date(Date.now() - 60 * 60_000) } },
  });
  if (res.count > 0) console.log(`[sweep] removed ${res.count} orphaned vault secret(s)`);
  return { deleted: res.count };
}
