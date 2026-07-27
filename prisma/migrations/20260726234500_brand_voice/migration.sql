-- AI-1: per-operator brand voice guide + optional AI style fingerprint.
CREATE TABLE "BrandVoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tone" TEXT,
    "audience" TEXT,
    "dos" TEXT,
    "donts" TEXT,
    "bannedWords" TEXT,
    "sampleHooks" TEXT,
    "fingerprint" TEXT,
    "fingerprintAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandVoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BrandVoice_userId_key" ON "BrandVoice"("userId");
