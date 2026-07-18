/* Next.js instrumentation hook — boots the publish worker inside the server
 * process. In a multi-instance deployment, run the worker as its own process
 * instead (the queue's atomic claims already make that safe). */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validate configuration before doing anything else — in production this
    // aborts the boot on any critical misconfiguration (missing vault key,
    // dev bypass left on, etc.) rather than serving traffic half-secured.
    const { assertConfigAtBoot } = await import("@/lib/server/config");
    assertConfigAtBoot();

    // Put SQLite into WAL mode before any traffic or the worker touches it.
    const { initDatabasePragmas } = await import("@/lib/server/db");
    await initDatabasePragmas();

    const { startWorker } = await import("@/lib/server/worker");
    startWorker();
  }
}
