-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VaultSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "label" TEXT,
    "scopes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "expiresAt" DATETIME,
    "tokenRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SocialAccount_tokenRef_fkey" FOREIGN KEY ("tokenRef") REFERENCES "VaultSecret" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "variants" TEXT,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "baseCaption" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Promo',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "captionOverride" TEXT,
    "assetIds" TEXT,
    "scheduledAt" DATETIME,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "permalink" TEXT,
    "error" TEXT,
    CONSTRAINT "PostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostTarget_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postTargetId" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishJob_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_tokenRef_key" ON "SocialAccount"("tokenRef");

-- CreateIndex
CREATE INDEX "SocialAccount_userId_platform_idx" ON "SocialAccount"("userId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_platform_externalId_key" ON "SocialAccount"("platform", "externalId");

-- CreateIndex
CREATE INDEX "PostTarget_state_scheduledAt_idx" ON "PostTarget"("state", "scheduledAt");

-- CreateIndex
CREATE INDEX "PublishJob_runAt_completedAt_idx" ON "PublishJob"("runAt", "completedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");
