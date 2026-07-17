-- AlterTable
ALTER TABLE "PublishJob" ADD COLUMN "claimedAt" DATETIME;

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "baseCaption" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Promo',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("baseCaption", "category", "createdAt", "id", "status", "updatedAt", "userId") SELECT "baseCaption", "category", "createdAt", "id", "status", "updatedAt", "userId" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
