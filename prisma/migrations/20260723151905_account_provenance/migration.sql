-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT,
    "provenance" TEXT NOT NULL DEFAULT 'real',
    "scopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "expiresAt" DATETIME,
    "tokenRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialAccount_tokenRef_fkey" FOREIGN KEY ("tokenRef") REFERENCES "VaultSecret" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SocialAccount" ("createdAt", "expiresAt", "externalId", "handle", "id", "label", "mark", "name", "platform", "scopes", "status", "tokenRef", "updatedAt", "userId") SELECT "createdAt", "expiresAt", "externalId", "handle", "id", "label", "mark", "name", "platform", "scopes", "status", "tokenRef", "updatedAt", "userId" FROM "SocialAccount";
DROP TABLE "SocialAccount";
ALTER TABLE "new_SocialAccount" RENAME TO "SocialAccount";
CREATE UNIQUE INDEX "SocialAccount_tokenRef_key" ON "SocialAccount"("tokenRef");
CREATE INDEX "SocialAccount_userId_platform_idx" ON "SocialAccount"("userId", "platform");
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill provenance from the historical, overloaded `label` markers. Only the
-- KNOWN non-real markers map to non-real; any custom user label stays 'real'
-- (mirrors src/lib/taxonomy.ts LEGACY_LABEL_PROVENANCE).
UPDATE "SocialAccount" SET "provenance" = 'demo' WHERE "label" = 'demo';
UPDATE "SocialAccount" SET "provenance" = 'mock' WHERE "label" IN ('mock connection', 'test (mock)', 'test fixture');
