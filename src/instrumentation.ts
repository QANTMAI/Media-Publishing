/* Next.js instrumentation hook — boots the publish worker inside the server
 * process. In a multi-instance deployment, run the worker as its own process
 * instead (the queue's atomic claims already make that safe). */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/server/worker");
    startWorker();
  }
}
