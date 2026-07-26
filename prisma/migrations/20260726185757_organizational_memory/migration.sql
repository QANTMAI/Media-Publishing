-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "lane" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "confidence" REAL,
    "tags" TEXT,
    "supersedes" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memoryItemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryLink_memoryItemId_fkey" FOREIGN KEY ("memoryItemId") REFERENCES "MemoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemoryItem_lane_status_idx" ON "MemoryItem"("lane", "status");

-- CreateIndex
CREATE INDEX "MemoryItem_status_updatedAt_idx" ON "MemoryItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MemoryLink_memoryItemId_idx" ON "MemoryLink"("memoryItemId");
