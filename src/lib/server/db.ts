import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** SQLite runs in dev, test, AND production (single-operator by design). Put
 * the database into WAL mode at boot: it lets the in-process worker write while
 * web requests read without blocking, and it's the mode Litestream streams for
 * continuous backups. journal_mode=WAL persists in the database file; the other
 * pragmas tune lock-wait and durability. No-op for a non-SQLite URL. */
export async function initDatabasePragmas(): Promise<void> {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) return;
  // These PRAGMAs return a row (the new setting), so use $queryRawUnsafe —
  // $executeRawUnsafe rejects statements that return results on SQLite.
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await db.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  await db.$queryRawUnsafe("PRAGMA synchronous=NORMAL;");
}

/** Organizational-memory full-text index. FTS5 is a virtual table Prisma
 * doesn't model, so it lives here — created idempotently at boot and kept in
 * sync by triggers. Derived infrastructure: safe to rebuild (e.g. after a
 * Litestream restore), which the backfill at the end guarantees. */
export async function ensureMemoryFts(): Promise<void> {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) return;
  await db.$executeRawUnsafe(
    `CREATE VIRTUAL TABLE IF NOT EXISTS MemoryItem_fts USING fts5(memoryId UNINDEXED, title, body);`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER IF NOT EXISTS MemoryItem_fts_ai AFTER INSERT ON MemoryItem BEGIN
       INSERT INTO MemoryItem_fts(memoryId, title, body) VALUES (new.id, new.title, new.body);
     END;`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER IF NOT EXISTS MemoryItem_fts_ad AFTER DELETE ON MemoryItem BEGIN
       DELETE FROM MemoryItem_fts WHERE memoryId = old.id;
     END;`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER IF NOT EXISTS MemoryItem_fts_au AFTER UPDATE ON MemoryItem BEGIN
       DELETE FROM MemoryItem_fts WHERE memoryId = old.id;
       INSERT INTO MemoryItem_fts(memoryId, title, body) VALUES (new.id, new.title, new.body);
     END;`,
  );
  // Backfill any rows created before the index existed (or after a restore).
  await db.$executeRawUnsafe(
    `INSERT INTO MemoryItem_fts(memoryId, title, body)
       SELECT id, title, body FROM MemoryItem
       WHERE id NOT IN (SELECT memoryId FROM MemoryItem_fts);`,
  );
}
