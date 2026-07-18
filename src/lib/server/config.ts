/* Production configuration guard. Enumerates every environment variable the
 * app reads, validates the security-critical ones, and fails the boot fast in
 * production rather than letting the server run half-configured (a missing
 * VAULT_MASTER_KEY or a dev auth-bypass left on in prod must never start
 * silently). In development it only warns, so the zero-setup local flow stays
 * frictionless. */

export interface ConfigReport {
  errors: string[];
  warnings: string[];
}

/** Byte length of a base64-encoded string (0 if absent/invalid). */
function base64Bytes(v: string | undefined): number {
  if (!v) return 0;
  try {
    return Buffer.from(v, "base64").length;
  } catch {
    return 0;
  }
}

type Env = Record<string, string | undefined>;

/** Validate an environment. Pure (takes the env in) so it's unit-testable.
 * `errors` block a production boot; `warnings` are always advisory. */
export function checkConfig(env: Env = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === "production";
  const require_ = isProd ? errors : warnings; // in dev these are advisory

  // ── Always-critical secrets (the app throws lazily without them; surface
  //    it at boot with a clear message instead). ──
  if (!env.SESSION_SECRET) require_.push("SESSION_SECRET is not set (JWT session signing key)");
  else if (env.SESSION_SECRET.length < 32) require_.push("SESSION_SECRET should be at least 32 characters");

  const vaultBytes = base64Bytes(env.VAULT_MASTER_KEY);
  if (!env.VAULT_MASTER_KEY) require_.push("VAULT_MASTER_KEY is not set (AES-256-GCM master key for the secrets vault)");
  else if (vaultBytes !== 32) require_.push("VAULT_MASTER_KEY must be exactly 32 bytes, base64-encoded");

  const signBytes = base64Bytes(env.STORAGE_SIGNING_KEY);
  if (!env.STORAGE_SIGNING_KEY) require_.push("STORAGE_SIGNING_KEY is not set (signs expiring media URLs)");
  else if (signBytes < 32) require_.push("STORAGE_SIGNING_KEY must be at least 32 bytes, base64-encoded");

  // ── Database ──
  // SQLite is the engine in every environment (single-operator by design). In
  // production the file must live on a persistent, backed-up volume — see the
  // WAL + Litestream setup in docs/DEPLOYMENT.md. We can't verify the path is
  // durable from here, so this stays a doc-level concern, not a boot check.
  if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set");

  // ── Production-only hardening ──
  if (isProd) {
    if (env.AUTH_DEV_BYPASS === "1") errors.push("AUTH_DEV_BYPASS=1 in production — the 2FA bypass must be OFF (unset it)");
    if (!env.PUBLIC_ORIGIN) errors.push("PUBLIC_ORIGIN is not set (required for signed media URLs / real IG publishing)");
    else if (!env.PUBLIC_ORIGIN.startsWith("https://")) errors.push("PUBLIC_ORIGIN must be an https:// URL in production");
  }

  // ── Meta OAuth: real mode needs real credentials ──
  const mock = env.OAUTH_MOCK === "1";
  if (mock) {
    if (isProd) warnings.push("OAUTH_MOCK=1 — publishing runs in MOCK mode; no posts reach real platforms");
  } else {
    for (const k of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"] as const) {
      if (!env[k]) require_.push(`${k} is not set (required when OAUTH_MOCK is off)`);
    }
    if (env.META_REDIRECT_URI && isProd && !env.META_REDIRECT_URI.startsWith("https://")) {
      warnings.push("META_REDIRECT_URI should be https:// in production");
    }
  }

  // ── Email (optional): both halves or neither ──
  if (!!env.SMTP_URL !== !!env.SMTP_FROM) {
    warnings.push("SMTP is half-configured — set BOTH SMTP_URL and SMTP_FROM, or neither (email notifications will be disabled)");
  }

  return { errors, warnings };
}

/** Run at server boot: log the report, and in production abort on any error so
 * a misconfigured instance never accepts traffic. */
export function assertConfigAtBoot(env: Env = process.env): void {
  const { errors, warnings } = checkConfig(env);
  for (const w of warnings) console.warn(`[config] warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[config] ERROR: ${e}`);
    if (env.NODE_ENV === "production") {
      throw new Error(`Refusing to start: ${errors.length} configuration error(s). See the [config] ERROR lines above.`);
    }
    console.warn("[config] (development) continuing despite errors — these would abort a production boot.");
  } else {
    console.log("[config] configuration OK");
  }
}
