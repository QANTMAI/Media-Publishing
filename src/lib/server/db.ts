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
