/* Minimal structured logger (audit R2). Production emits one JSON object per
 * line ({level, ts, msg, ...fields}) so logs are machine-parseable and the
 * load-bearing events (e.g. a published-but-not-recorded publish) are
 * alertable. Development prints a compact human-readable line. No dependency.
 *
 * NEVER pass secrets in fields — call sites log ids/messages only. Errors are
 * serialized to {name, message} so they don't vanish as "{}". */

type Fields = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";

function safeStringify(o: unknown): string {
  try {
    return JSON.stringify(o, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
  } catch {
    return String(o);
  }
}

function emit(level: "info" | "warn" | "error", msg: string, fields?: Fields): void {
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (isProd) {
    sink(safeStringify({ level, ts: new Date().toISOString(), msg, ...(fields ?? {}) }));
  } else {
    const extra = fields && Object.keys(fields).length ? ` ${safeStringify(fields)}` : "";
    sink(`[${level}] ${msg}${extra}`);
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
