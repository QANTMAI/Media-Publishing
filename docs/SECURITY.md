# Security notes

The security posture (mandatory TOTP, AES-256-GCM vault, signed media URLs,
CSP/HSTS headers, boot config guard, audit log) is described in
[ARCHITECTURE.md](ARCHITECTURE.md) and [DEPLOYMENT.md](DEPLOYMENT.md). This file
tracks dependency advisories and any accepted risks — so nothing is silently
unaddressed.

## Policy

- Runtime dependencies: **zero tolerance** — patched promptly (see the
  nodemailer + fast-xml-parser bumps in git history).
- Dev/build-only dependencies: patched when a non-breaking fix exists;
  otherwise documented here with evidence and a revisit condition.
- Every advisory is triaged against the **production** tree
  (`npm ls <pkg> --omit=dev`), not just the flat audit.

## Accepted risk — `brace-expansion` DoS (dev-only)

- **Advisory:** [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) — DoS via unbounded brace expansion (high).
- **Where:** transitively under **ESLint** only (`@eslint/config-array` →
  `minimatch@3` → `brace-expansion@1.x`). The one same-major instance that
  *could* be patched (`brace-expansion@5.0.7` under `@typescript-eslint`) is
  pinned to `5.0.8` via `overrides`.
- **Production exposure: NONE.** `npm ls brace-expansion --omit=dev` → empty.
  It ships in no runtime bundle; it runs only in `next lint` at dev/CI time.
- **Exploitability here: none realistic.** The DoS needs an attacker-controlled
  glob pattern; ESLint only globs our own trusted source files.
- **Why not "fixed":** npm records the fix only at `brace-expansion ≥ 5.0.8`,
  and both available upgrade paths **break the linter** (verified):
  - Forcing `brace-expansion@5.0.8` globally → `minimatch@3` does
    `require('brace-expansion')()` but 5.x is a *named* export → runtime
    `expand is not a function`.
  - `eslint@10` (which drops the `minimatch@3` chain) → `eslint-plugin-react`
    is not yet compatible with eslint 10's rule API
    (`context.getFilename is not a function`).
- **Revisit when:** `eslint-plugin-react` / `eslint-config-next` support
  `eslint@10`, **or** a Next.js release ships a lint stack on patched
  `brace-expansion`. Then bump and drop the partial override. Re-check with
  `npm audit` + `npm ls brace-expansion --omit=dev`.
