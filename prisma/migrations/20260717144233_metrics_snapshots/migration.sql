-- AlterTable
ALTER TABLE "PostTarget" ADD COLUMN "externalMediaId" TEXT;

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postTargetId" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "raw" TEXT NOT NULL,
    CONSTRAINT "MetricSnapshot_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MetricSnapshot_postTargetId_fetchedAt_idx" ON "MetricSnapshot"("postTargetId", "fetchedAt");
