/* Operator maintenance: remove any MOCK/fixture social accounts (provenance not
 * "real"), plus their vault secrets and orphaned posts. Real connections are
 * left untouched.
 *
 *   node --env-file=.env scripts/remove-mock-accounts.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const mocks = await db.socialAccount.findMany({
    where: { NOT: { provenance: "real" } },
    select: { id: true, platform: true, handle: true, provenance: true, tokenRef: true },
  });
  if (mocks.length === 0) {
    console.log("No mock/fixture accounts — nothing to remove.");
  } else {
    for (const a of mocks) {
      if (a.tokenRef) {
        await db.socialAccount.update({ where: { id: a.id }, data: { tokenRef: null } });
        await db.vaultSecret.delete({ where: { id: a.tokenRef } }).catch(() => {});
      }
      await db.socialAccount.delete({ where: { id: a.id } });
      console.log(`Removed ${a.platform} ${a.handle} (provenance=${a.provenance ?? "null"})`);
    }
    // Sweep posts left with no targets.
    const orphans = await db.post.deleteMany({ where: { targets: { none: {} } } });
    console.log(`Removed ${mocks.length} account(s); swept ${orphans.count} orphaned post(s).`);
  }
} finally {
  await db.$disconnect();
}
