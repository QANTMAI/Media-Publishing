/* Operator maintenance: enable or disable two-factor for an account.
 *
 *   node --env-file=.env scripts/set-2fa.mjs <email> off   # clear TOTP → password-only
 *   node --env-file=.env scripts/set-2fa.mjs <email> on    # mark for re-enrollment
 *
 * Disabling clears the stored secret and replay counter, so the next /login is
 * password-only. Enabling only flips the flag; the operator must re-enroll a
 * fresh authenticator (there is no secret until they do) — use the /setup or a
 * future settings flow to actually scan a QR. Single-operator, local-first.
 */
import { PrismaClient } from "@prisma/client";

const [, , email, mode] = process.argv;
if (!email || !["on", "off"].includes(mode)) {
  console.error("usage: node --env-file=.env scripts/set-2fa.mjs <email> <on|off>");
  process.exit(2);
}

const db = new PrismaClient();
try {
  const data =
    mode === "off"
      ? { totpEnabled: false, totpSecret: null, totpLastStep: null }
      : { totpEnabled: true };
  const res = await db.user.updateMany({ where: { email: email.toLowerCase() }, data });
  if (res.count === 0) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }
  const u = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { email: true, totpEnabled: true },
  });
  console.log(`2FA ${mode.toUpperCase()} for ${u.email} (totpEnabled=${u.totpEnabled})`);
} finally {
  await db.$disconnect();
}
