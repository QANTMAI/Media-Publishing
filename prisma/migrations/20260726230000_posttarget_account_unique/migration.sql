-- Prevent duplicate PostTargets for the same (post, account) at the DB level.
-- (No duplicates exist in dev.db — verified before authoring this migration.)
CREATE UNIQUE INDEX "PostTarget_postId_socialAccountId_key" ON "PostTarget"("postId", "socialAccountId");
