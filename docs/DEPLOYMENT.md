# Deployment

Production checklist for the QANTM Media Portal. The app boots a config guard
(`src/lib/server/config.ts`) that **refuses to start in production** if a
security-critical value is missing or weak — so a misconfigured instance fails
loudly instead of serving traffic half-secured.

## 1. Prerequisites

- **Node.js 20+** (the app uses `--env-file`, `AbortSignal.timeout`, the
  instrumentation hook).
- **A persistent disk volume** for the SQLite database + `storage/` directory.
- **[Litestream](https://litestream.io)** (a single static binary) for continuous database backups.
- A TLS-terminating reverse proxy (nginx, Caddy, a cloud LB) in front of the app.
- **ffmpeg/ffprobe** are bundled via `ffmpeg-static`/`ffprobe-static` — no system install needed.

## 2. Secrets

Generate the three base64 secrets (each **32 bytes**):

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # VAULT_MASTER_KEY   (must decode to exactly 32 bytes)
openssl rand -base64 32   # STORAGE_SIGNING_KEY
```

Set every variable from [`.env.example`](../.env.example) in your secrets
manager (not a committed file). `VAULT_MASTER_KEY` is the AES-256-GCM master key
for the credential vault — treat it like a root key: store it in KMS/Secrets
Manager, restrict access, and have a rotation plan. Losing it makes every stored
OAuth token and API key unrecoverable; leaking it compromises all of them.

## 3. Database (SQLite + WAL + Litestream)

This is a single-operator app, and it runs **SQLite in every environment** —
dev, test, and production. That gives exact dev/prod parity (the test suite
exercises the real production engine) and keeps operations simple. The
in-process worker and web requests share one file; durability comes from WAL
mode plus continuous streaming backups, not from a separate database server.

1. Put the database on a **persistent, backed-up volume** and point at it:

   ```bash
   DATABASE_URL="file:/var/lib/qantm/prod.db"
   ```

   It must survive restarts/redeploys — never an ephemeral container path.

2. Apply the schema and generate the client:

   ```bash
   npx prisma migrate deploy   # applies prisma/migrations/ to the file
   npx prisma generate
   ```

3. **WAL mode is enabled automatically at boot** (`initDatabasePragmas()` in
   `src/lib/server/db.ts`), which is what lets the worker write while requests
   read, and is Litestream's prerequisite. WAL creates `prod.db-wal` and
   `prod.db-shm` sidecars next to the file — leave them in place.

4. **Continuous backups with Litestream.** Run it as a sidecar that streams the
   database to object storage (S3, GCS, etc.). Minimal `litestream.yml`:

   ```yaml
   dbs:
     - path: /var/lib/qantm/prod.db
       replicas:
         - url: s3://my-bucket/qantm-db
   ```

   ```bash
   litestream replicate -config litestream.yml
   ```

   Restore before a fresh boot with `litestream restore -o /var/lib/qantm/prod.db s3://my-bucket/qantm-db`.
   The database holds vault ciphertext, the audit log, and the queue — secrets
   are encrypted at rest, but protect the backup bucket regardless.

> Why not Postgres? For one operator, SQLite in WAL mode with Litestream is
> durable, faster (no network round-trip), and eliminates a moving part. If the
> app ever needs multiple concurrent writers or a managed database, revisit
> this — the schema is written portably (no SQLite-only features).

## 4. First-run operator setup

The portal is single-operator. On first launch, the setup flow creates the
operator account and enrolls TOTP two-factor auth (mandatory). Complete it over
HTTPS from a trusted device. There is no self-service signup — this is
intentional.

## 5. Build & run

```bash
npm ci
npm run build
npm run start          # serves on $PORT (default 3000)
```

The **publish worker runs in-process** via `src/instrumentation.ts` (polls the
queue, transcodes video, pulls metrics, polls RSS feeds). For a single instance
this is all you need. For **multiple app instances**, run the worker as its own
single process instead (the queue's atomic claims already make double-publish
impossible) so you don't run N pollers — see the note in `instrumentation.ts`.

## 6. Reverse proxy & TLS

- Terminate TLS at the proxy and forward to the app.
- The app already sets CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  `Referrer-Policy`, HSTS, and `Permissions-Policy` (see `next.config.mjs`).
  HSTS is only effective over HTTPS.
- If (and only if) the proxy overwrites `X-Forwarded-For`, set `TRUST_PROXY=1`
  so audit IPs are trustworthy. Without a trusted proxy, leave it unset — the
  header is otherwise client-spoofable.

## 7. Meta OAuth (real publishing)

Mock mode (`OAUTH_MOCK=1`) lets every screen work without a Meta app, but
nothing reaches real platforms. To publish for real:

1. Create a Meta app (Instagram + Facebook + Threads share one) and complete app review for the publishing permissions.
2. Set `META_APP_ID`, `META_APP_SECRET`, and
   `META_REDIRECT_URI=https://<your-origin>/api/oauth/meta/callback`.
3. Set `OAUTH_MOCK=0`. The config guard then **requires** the `META_*` values.
4. Set `PUBLIC_ORIGIN=https://<your-origin>` — Instagram fetches media from us,
   so real IG image/Reel publishing needs a public HTTPS origin.

## 8. Email notifications (optional)

Set **both** `SMTP_URL` (e.g. `smtps://user:pass@smtp.host:465`) and `SMTP_FROM`
to enable email mirroring of notifications. Leave both empty to disable — the
app then records notifications in-app only and the Settings UI says email isn't
configured. Setting only one logs a config warning.

## 9. AI captions (optional)

AI provider keys are **not** environment variables. The operator adds an
Anthropic key in-app under **Settings → Integrations & keys**; it's stored
encrypted in the same vault as OAuth tokens and used server-side only.

## 10. Pre-launch security checklist

- [ ] `SESSION_SECRET`, `VAULT_MASTER_KEY`, `STORAGE_SIGNING_KEY` set to freshly generated 32-byte secrets (not the dev values).
- [ ] `AUTH_DEV_BYPASS` **unset** (the guard aborts the boot if it's `1` in production).
- [ ] `PUBLIC_ORIGIN` set to your `https://` origin.
- [ ] `DATABASE_URL` points at a SQLite file on a **persistent** volume; Litestream replicating it to off-box storage.
- [ ] `OAUTH_MOCK=0` and `META_*` set (if publishing for real).
- [ ] TLS enforced; HSTS reaching browsers; security headers present (`curl -I`).
- [ ] Operator TOTP enrolled; the dev-login page/route are inert in prod.
- [ ] `VAULT_MASTER_KEY` in KMS with a rotation + backup plan.
- [ ] `/api/health` returns `200 {"status":"ok"}` behind the LB.

## 11. Health & operations

- **Health probe:** `GET /api/health` — `200 {status:"ok", db:true, publishing:"mock|live", email:bool}` when healthy, `503` when the database is unreachable. Unauthenticated and secret-free; wire it to the load balancer.
- **Kill switch:** the topbar "Pause all publishing" holds the entire queue instantly (persisted; the worker respects it). Use it during incidents.
- **Audit log:** every auth, connect, publish, and settings change is recorded (`AuditEvent`); metadata never contains secrets.
- **Key rotation:** rotating `VAULT_MASTER_KEY` requires re-encrypting stored secrets — the vault carries a `keyVersion` seam for this; plan a maintenance step before rotating.
