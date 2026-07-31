# Real publishing — what the operator must supply

Everything here is **your** dependency: developer apps, credentials, and account
prerequisites I cannot create for you. Each item says what to get, where, how
long it takes, and **whether a real post is possible today**. Grounded in the
actual code (OAuth routes + `src/lib/server/publisher.ts` + `config.ts`), not
assumptions.

## Status already set (no action from you)

- ✅ 2FA off → `/login` is email + password only.
- ✅ `OAUTH_MOCK=0` → app is in **live** posture (`/api/health` → `"live"`).
- ✅ Meta partial-config landmine cleared (would have aborted a prod/Render boot).
- ⚠️ Your 3 current accounts (`@fixture.test`, `Fixture Channel`, `@fixture_x`)
  are **test fixtures with mock tokens** — they publish to a fake URL, never a
  real platform. Remove them before real testing (I can do this on your word).

Policy from the code: with `OAUTH_MOCK=0`, a platform whose env vars are **unset**
still falls back to *labeled mock* connects — so nothing breaks, but nothing is
real until you supply that platform's credentials. Partial config (some but not
all of a group) is a hard error in production.

---

## Platform-by-platform

### 1. Bluesky — ✅ REAL post possible TODAY (recommended first test)

The only platform with **no developer app, no review, no public origin**.

- **You provide:** a Bluesky handle + an **App Password**
  (Bluesky app → Settings → Privacy and Security → App Passwords). Format
  `xxxx-xxxx-xxxx-xxxx`. **Not** your main password (the code rejects it).
- **Constraint:** the account must **not** require email 2FA at sign-in (app
  passwords can't satisfy it).
- **Env vars:** none.
- **How:** in-app → Accounts → connect Bluesky → enter handle + app password.
- **Capability:** text + up to 4 images (<1 MB each). No video.
- **Effort:** ~5 minutes.

### 2. LinkedIn — real text post feasible today (~30 min setup)

- **You provide** (from https://www.linkedin.com/developers/):
  - Create an app, then enable the **two self-serve products** (instant, no
    review): *Sign In with LinkedIn using OpenID Connect* + *Share on LinkedIn*.
  - `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
  - Authorized redirect URL: `<PUBLIC_ORIGIN>/api/oauth/linkedin/callback`.
- **Blocker:** LinkedIn generally requires a real (non-localhost) redirect URL →
  needs a **public origin** (deploy to Render, or a tunnel).
- **Capability:** text only (media is a later wave). Token **expires in 60 days**
  → reconnect after that (no refresh for standard apps).

### 3. YouTube — real PRIVATE upload feasible today (~30 min setup)

- **You provide** (from Google Cloud Console):
  - A project → OAuth consent screen (External, **Testing** mode) → add
    **yourself as a Test user**.
  - OAuth client (Web application): `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.
  - Authorized redirect URI: `<PUBLIC_ORIGIN>/api/oauth/youtube/callback`
    (Google **does** allow `http://localhost:3000/...` for testing).
- **Account prereq:** a YouTube **channel** on that Google account + a **video**
  asset to upload.
- **Constraint:** until Google's **compliance audit**, uploads are forced
  **Private** and only work for accounts added as Test users. Quota ~6/day.
- **Capability:** video only (that's what YouTube is here).

### 4. Meta — Facebook + Instagram (partial today, full = App Review, days)

One Meta app covers both.

- **You provide** (from https://developers.facebook.com/):
  - A Meta app in **Development** mode: `META_APP_ID`, `META_APP_SECRET`.
  - Redirect: `<PUBLIC_ORIGIN>/api/oauth/meta/callback`.
- **Facebook Page text posts:** work for **you** (the app admin) in dev mode
  **without** App Review.
- **Instagram** additionally needs, and these are the real blockers:
  - An Instagram **Business/Creator** account **linked to a Facebook Page**.
  - **App Review** for `instagram_content_publish` (+ related scopes) — days to
    weeks, not same-day.
  - A public **`PUBLIC_ORIGIN` (https)** — Meta's servers fetch your media from
    this portal, so **localhost will not work for Instagram**.
- **Blocker:** Meta requires an https redirect on a real domain → **public origin
  required even for the Facebook path** (deploy to Render).

### 5. X / Twitter, TikTok, Threads — NOT IMPLEMENTED

No adapter, no OAuth route in the code. A real post routes to a
`PermanentError("…not integrated yet")`. **No credential you supply will make
these publish** — they are future development work, not a setup step. (X is
consistent with you not having the paid API.)

---

## Cross-cutting dependencies

| Dependency | Needed for | Your action |
|---|---|---|
| **Public origin** (`PUBLIC_ORIGIN`, https) | Instagram media fetch; OAuth callbacks that reject localhost (Meta, likely LinkedIn) | Deploy to **Render** (you have the account; blueprint is ready) → gives a public https URL. Or run a tunnel (cloudflared/ngrok) for a session. |
| **Anthropic API key** | AI features (repurpose, brand voice) | Enter **in-app** under Settings → Integrations & keys (format `sk-ant-…`). Not an env var. |
| **App passwords / client secrets** | Each platform above | Only you can generate them in each provider's console. |

## What I do the moment you hand me each credential

Paste the OAuth credentials (or the Bluesky app password goes straight in the
UI) and I will: set the env group all-or-none, set the matching redirect URI,
restart, confirm `/api/health` and the connect flow, then walk a **real test
post** end-to-end and verify it landed.

## Recommended order for testing today

1. **Bluesky now** (~5 min) → prove a real post end-to-end today.
2. If you want more platforms: **deploy to Render** for a public origin, then add
   **LinkedIn** (fastest OAuth — self-serve, no review), then YouTube (private
   test), then Meta/Facebook. Instagram waits on App Review.
