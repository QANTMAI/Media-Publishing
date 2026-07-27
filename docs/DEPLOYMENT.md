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

4. **Continuous backups with Litestream (primary).** Run it as a sidecar that
   streams the WAL to object storage (S3/GCS/Azure/SFTP). A ready-to-edit config
   ships in the repo: **[`litestream.example.yml`](../litestream.example.yml)** —
   copy to `litestream.yml`, set the replica URL + credentials, then:

   ```bash
   litestream replicate -config litestream.yml
   ```

   Restore before a fresh boot: `litestream restore -o /var/lib/qantm/prod.db s3://my-bucket/qantm-db`.

5. **Local backup fallback (zero-dependency).** Even with Litestream, a
   scheduled local snapshot is a cheap floor:

   ```bash
   npm run db:backup   # SQLite VACUUM INTO → BACKUP_DIR (default ./backups), keeps BACKUP_KEEP (14)
   ```

   It's an online, WAL-aware, transactionally-consistent snapshot (no downtime,
   no `sqlite3` CLI). Wire it to cron for defense-in-depth. **This is a local
   floor, not off-box durability** — keep Litestream (or copy the snapshots
   off-box) for real disaster recovery.

Once backups are wired, set **`DB_BACKUP_CONFIGURED=1`** — the config guard
warns at every prod boot until you do. The database holds vault **ciphertext**,
the audit log, and the queue; secrets are encrypted at rest, but protect the
backup destination regardless.

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

## 5b. Container image (GHCR)

A production `Dockerfile` and the **Publish container image** GitHub Actions
workflow build and push an image to GHCR on every push to `main` (and on `v*`
tags). This publishes an **image only** — it deploys nothing and handles no
secrets. The image is at `ghcr.io/<owner>/<repo>` (e.g.
`ghcr.io/qantmai/media-publishing`), tagged `latest`, `sha-<commit>`, and any
semver tag.

The image is a two-stage build on Debian slim (glibc, so `sharp` /
`ffmpeg-static` / `ffprobe-static` binaries resolve). It runs `next start`,
which also boots the in-process worker. At container start the entrypoint
**fails fast if a real secret is missing**, applies `prisma migrate deploy`,
then serves on `$PORT` (default 3000).

Run it with real secrets and a **persistent volume** for SQLite (mount at
`/app/data` — `DATABASE_URL` defaults to `file:/app/data/prod.db`):

```bash
docker run -d --name qantm-portal \
  -p 3000:3000 \
  -v qantm-data:/app/data \
  -e SESSION_SECRET="$(openssl rand -base64 32)" \
  -e VAULT_MASTER_KEY="<32-byte base64 — KEEP THIS; without it the vault is unrecoverable>" \
  -e STORAGE_SIGNING_KEY="$(openssl rand -base64 32)" \
  ghcr.io/qantmai/media-publishing:latest
```

Notes:

- **The volume is not a backup.** A container image + a single volume still
  needs off-box durability — configure Litestream (§3) and set
  `DB_BACKUP_CONFIGURED=1`. A restore is useless without `VAULT_MASTER_KEY`.
- **Never** set `AUTH_DEV_BYPASS` in a production container (it is code-gated
  to non-production, but the variable should simply be absent).
- The image has no host platform assumptions beyond `linux/amd64` (what the
  workflow builds). Add `platforms:` to the build step for multi-arch.
- GHCR packages are **private by default**; make the package public or grant
  pull access in the repo's *Packages* settings if another host needs to pull.

## 5c. Render (Blueprint)

`render.yaml` deploys the app to Render as a Docker web service with a
persistent disk. Render builds the `Dockerfile` directly — no GHCR pull needed.

**Deploy:**

1. Render Dashboard → **New → Blueprint** → connect this repo. Render reads
   `render.yaml`.
2. It prompts for the three `sync: false` secrets. Generate each and paste it:
   ```bash
   openssl rand -base64 32   # SESSION_SECRET
   openssl rand -base64 32   # STORAGE_SIGNING_KEY
   openssl rand -base64 32   # VAULT_MASTER_KEY  (save this — see below)
   ```
3. **Apply** → Render builds the image, mounts the disk, and deploys. First
   boot runs `prisma migrate deploy` automatically (entrypoint), then serves.
4. Open the service URL and complete first-run operator setup (§4).

**What `render.yaml` sets up:**

- **Docker web service**, `plan: starter` (paid — required for the disk).
- **Persistent disk** `qantm-data` at `/app/data`, holding **both** the SQLite
  DB (`DATABASE_URL=file:/app/data/prod.db`) and uploaded media
  (`STORAGE_DIR=/app/data/storage`), so nothing is lost on redeploy.
- **Health check** at `/api/health`; **auto-deploy** on every push to `main`.
- The container starts as root only to `chown` the freshly-mounted disk, then
  drops to a non-root user (gosu) to run.

**Cautions (real, not boilerplate):**

- ⚠️ **A paid instance is mandatory.** Free/ephemeral Render instances have no
  persistent disk — the database and all media are wiped on every deploy. The
  blueprint pins `plan: starter` for this reason; do not downgrade it.
- 🔑 **`VAULT_MASTER_KEY` is forever.** It decrypts every stored OAuth token and
  API key. If it changes (or is lost), the vault is permanently unreadable —
  every connected account must be re-linked. Store it in a password manager.
- 💾 **A disk is not a backup.** It survives deploys, not disk failure or an
  accidental service delete. Add Litestream (§3) and set `DB_BACKUP_CONFIGURED=1`
  for off-box durability before relying on this in production.
- 🔒 Never add `AUTH_DEV_BYPASS` to the Render environment. Sign-in there is the
  real `/login` (password, plus TOTP if the operator enrolled it).

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

## 8. YouTube (real publishing)

YouTube uploads via the Data API v3 (Google OAuth). To publish for real:

1. In [console.cloud.google.com](https://console.cloud.google.com): create a project, **enable "YouTube Data API v3"**, configure the OAuth consent screen, and add the scopes `youtube.upload` + `youtube.readonly`.
2. Create an **OAuth 2.0 Client ID** (type: Web application) with the authorized redirect URI `https://<your-origin>/api/oauth/youtube/callback`.
3. Set `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, and `OAUTH_MOCK=0`. The config guard then requires all three `YOUTUBE_*` values (all-or-none).
4. Connect at **Accounts → Connect → YouTube**. The grant uses `access_type=offline` + `prompt=consent`, so we store the durable **refresh token** in the vault and mint a short-lived access token per publish.

> ⚠️ **Two real constraints, surfaced honestly, not worked around:**
> - **Unaudited-app restriction:** until the app passes YouTube's API compliance audit, uploaded videos are locked to **private** regardless of the requested visibility. Add your own Google account as a **test user** on the consent screen to publish while unaudited.
> - **Quota:** `videos.insert` costs ~1600 units against a default 10,000/day quota (~6 uploads/day) until you request an increase. The publisher fails an over-quota upload permanently (`quotaExceeded`) rather than retry-looping and burning more quota.

YouTube is **video-only** — a post to a YouTube account must attach a video; the publisher rejects a missing/non-video asset with a clear error.

## 9. Email notifications (optional)

Set **both** `SMTP_URL` (e.g. `smtps://user:pass@smtp.host:465`) and `SMTP_FROM`
to enable email mirroring of notifications. Leave both empty to disable — the
app then records notifications in-app only and the Settings UI says email isn't
configured. Setting only one logs a config warning.

## 10. AI captions (optional)

AI provider keys are **not** environment variables. The operator adds an
Anthropic key in-app under **Settings → Integrations & keys**; it's stored
encrypted in the same vault as OAuth tokens and used server-side only.

## 11. Pre-launch security checklist

- [ ] `SESSION_SECRET`, `VAULT_MASTER_KEY`, `STORAGE_SIGNING_KEY` set to freshly generated 32-byte secrets (not the dev values).
- [ ] `AUTH_DEV_BYPASS` **unset** (the guard aborts the boot if it's `1` in production).
- [ ] `PUBLIC_ORIGIN` set to your `https://` origin.
- [ ] `DATABASE_URL` points at a SQLite file on a **persistent** volume; Litestream replicating it to off-box storage.
- [ ] `OAUTH_MOCK=0` and `META_*` set (if publishing for real).
- [ ] TLS enforced; HSTS reaching browsers; security headers present (`curl -I`).
- [ ] Operator TOTP enrolled; the dev-login page/route are inert in prod.
- [ ] `VAULT_MASTER_KEY` in KMS with a rotation + backup plan.
- [ ] `/api/health` returns `200 {"status":"ok"}` behind the LB.

## 12. Health & operations

- **Health probe:** `GET /api/health` — `200 {status:"ok", db:true, publishing:"mock|live", email:bool}` when healthy, `503` when the database is unreachable. Unauthenticated and secret-free; wire it to the load balancer.
- **Kill switch:** the topbar "Pause all publishing" holds the entire queue instantly (persisted; the worker respects it). Use it during incidents.
- **Audit log:** every auth, connect, publish, and settings change is recorded (`AuditEvent`); metadata never contains secrets.
- **Key rotation:** rotating `VAULT_MASTER_KEY` requires re-encrypting stored secrets — the vault carries a `keyVersion` seam for this; plan a maintenance step before rotating.

## 13. Disaster recovery (runbook)

Recovery has **two independent halves — you need both, or you recover nothing usable.**

1. **The database** — restore from Litestream (`litestream restore -o /var/lib/qantm/prod.db <replica-url>`) or copy the newest `db:backup` snapshot into place. With Litestream, RPO is ~seconds and RTO is one command + boot.
2. **The vault master key** — `VAULT_MASTER_KEY` is an **environment variable, not in the database**. The DB stores only *ciphertext* for every OAuth token and API key. **A DB restore without the original `VAULT_MASTER_KEY` recovers unreadable credentials** — every connected account would have to be reconnected from scratch. Back the key up **separately** in KMS / a secrets manager with its own recovery path.

**Restore procedure:**
1. Provision the host + persistent volume; install the app (`npm ci && npm run build`).
2. Restore the DB (Litestream or a `db:backup` snapshot) to the `DATABASE_URL` path. Leave the `-wal`/`-shm` sidecars to be recreated at boot.
3. Restore `VAULT_MASTER_KEY` (and `SESSION_SECRET`, `STORAGE_SIGNING_KEY`) from your secrets manager into the environment — the **same** values as before, or vault contents won't decrypt.
4. Restore the `storage/` media volume if used (or accept that media served from it is gone).
5. `npx prisma migrate deploy` (idempotent), boot, confirm `GET /api/health` → `200`.

**Test the restore before you need it.** An untested backup is a hypothesis. Periodically restore into a scratch environment and confirm a vaulted credential actually decrypts (e.g. an account can publish) — that proves both halves are intact, not just the DB file.
