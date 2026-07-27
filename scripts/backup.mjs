/* Zero-dependency online SQLite backup (audit R1 — backup automation was
 * verified absent). Uses SQLite's VACUUM INTO: a transactionally-consistent,
 * WAL-aware online snapshot that runs while the app is live — no downtime, no
 * `sqlite3` CLI (uses the Prisma-bundled engine). This is the LOCAL floor; for
 * off-box durability run Litestream (docs/DEPLOYMENT.md §3, litestream.example.yml).
 *
 * Invoke: npm run db:backup   (env: BACKUP_DIR=backups, BACKUP_KEEP=14) */
import { PrismaClient } from "@prisma/client";
import { mkdir, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(process.env.BACKUP_DIR ?? "backups");
const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? "14") || 14);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const db = new PrismaClient();
try {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `qantm-${stamp()}.db`);
  // VACUUM INTO takes a string-literal path. Our filename is timestamp-only
  // (no user input, no quotes), so this is not injectable; escape defensively
  // and use forward slashes (valid cross-platform for SQLite).
  const literal = target.replace(/'/g, "''").split(path.sep).join("/");
  await db.$executeRawUnsafe(`VACUUM INTO '${literal}'`);

  const { size } = await stat(target);
  console.log(`[backup] wrote ${target} (${(size / 1e6).toFixed(1)} MB)`);

  // Prune to the most recent `keep`.
  const files = (await readdir(dir)).filter((f) => /^qantm-\d{8}-\d{6}\.db$/.test(f)).sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const f of excess) await rm(path.join(dir, f), { force: true });
  if (excess.length) console.log(`[backup] pruned ${excess.length} old backup(s), keeping ${keep}`);
} catch (err) {
  console.error("[backup] FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
