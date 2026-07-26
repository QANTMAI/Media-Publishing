/* Seeds the single operator into the ISOLATED test database so the integration
 * suite can log in (real password + real TOTP), exactly matching what first-run
 * setup produces. Runs against whatever DATABASE_URL the harness passes (the
 * test DB) — never the dev DB. Idempotent. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";

const db = new PrismaClient();
const email = (process.env.TEST_EMAIL || "info@qantm.ai").toLowerCase();
const password = process.env.TEST_PASSWORD || "qantm-dev-2026!";

const existing = await db.user.findUnique({ where: { email } });
if (!existing) {
  await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      totpSecret: authenticator.generateSecret(),
      totpEnabled: true,
    },
  });
  console.log(`[test-db] seeded operator ${email}`);
} else if (!existing.totpEnabled || !existing.totpSecret) {
  await db.user.update({
    where: { id: existing.id },
    data: { totpEnabled: true, totpSecret: existing.totpSecret ?? authenticator.generateSecret() },
  });
  console.log(`[test-db] repaired operator ${email}`);
} else {
  console.log(`[test-db] operator ${email} already present`);
}
await db.$disconnect();
