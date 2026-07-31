/* Isolated integration-test harness.
 *
 * Runs the whole suite against a DEDICATED test database + a DEDICATED server
 * instance, so `npm test` NEVER touches the dev/operator database (its audit
 * log, episodic memory, accounts, …). This is the durable fix for the
 * "tests pollute the dev audit log" finding.
 *
 * Flow: point everything at test.db → migrate → seed the operator → boot a
 * server on a separate port + build dir → wait for health → run the tests →
 * tear the server down → exit with the tests' code.
 *
 * Invoked via `npm test` as: node --env-file=.env scripts/test-isolated.mjs
 * (so the secrets from .env are present; only DATABASE_URL is overridden). */
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readdirSync } from "node:fs";

const PORT = process.env.TEST_PORT || "3100";
const BASE = `http://localhost:${PORT}`;
// Everything below runs against the ISOLATED test DB + build dir.
const env = {
  ...process.env,
  DATABASE_URL: "file:./test.db",
  NEXT_DIST_DIR: ".next-test",
  PORT,
  // A dedicated test server must never run the dev 2FA bypass or mock-nothing.
  NODE_ENV: "development",
  // Deterministic mock mode for the suite (matches CI) — otherwise the local
  // .env's OAUTH_MOCK leaks in and OAuth-mock tests diverge local vs CI.
  OAUTH_MOCK: "1",
};

let server = null;
let cleanedUp = false;
function cleanup() {
  if (cleanedUp || !server) return;
  cleanedUp = true;
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {
    try {
      server.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (cleanup(), process.exit(1)));

function fail(msg) {
  console.error(`\n[test-harness] ${msg}`);
  cleanup();
  process.exit(1);
}

// 1) Apply the schema to the test DB (idempotent).
console.log("[test-harness] migrating test.db…");
try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
} catch {
  fail("prisma migrate deploy failed");
}

// 2) Seed the operator into the test DB.
console.log("[test-harness] seeding operator…");
try {
  execFileSync("node", ["--import", "tsx", "scripts/seed-test-operator.mts"], { stdio: "inherit", env });
} catch {
  fail("operator seed failed");
}

// 3) Boot the isolated server (own port, own build dir, test DB).
console.log(`[test-harness] starting test server on ${BASE} (test.db, .next-test)…`);
server = spawn("npx", ["next", "dev", "-p", PORT], { env, stdio: "inherit", detached: true });
server.on("exit", (code) => {
  if (!cleanedUp) fail(`test server exited early (code ${code})`);
});

// 4) Wait for health.
let healthy = false;
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(`${BASE}/api/health`);
    if (r.ok) {
      healthy = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await sleep(1000);
}
if (!healthy) fail("test server never became healthy");
console.log("[test-harness] server healthy — running tests\n");

// 5) Run the suite against the isolated server + DB. Expand the test files
// ourselves — `node --test` only supports glob patterns on Node 21+, and the
// app targets Node 20+, so passing "tests/*.test.mts" as a literal would break
// on the floor version (as CI on Node 20 proved).
const testFiles = readdirSync("tests")
  .filter((f) => f.endsWith(".test.mts"))
  .sort()
  .map((f) => `tests/${f}`);
if (testFiles.length === 0) fail("no *.test.mts files found in tests/");
const tests = spawn("node", ["--import", "tsx", "--test", ...testFiles], {
  env: { ...env, TEST_BASE_URL: BASE },
  stdio: "inherit",
});
tests.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 1);
});
