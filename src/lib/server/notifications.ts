import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { emailConfigured, sendEmail } from "./email";

/* Operator notifications. Created only by real events. In-app is the source of
 * truth; email is an opt-in mirror sent when SMTP is configured. Like audit(),
 * notify() never throws into its caller — a notification failure must not take
 * down a publish or an autopilot run. */

export interface NotifyType {
  label: string;
  description: string;
  level: "info" | "warn" | "error";
  defaultOn: boolean;
}

/** The events that can notify. Extensible — add a key here + call notify(). */
export const NOTIFY_TYPES: Record<string, NotifyType> = {
  publish_failed: {
    label: "Publish failures",
    description: "A scheduled post permanently failed to publish.",
    level: "error",
    defaultOn: true,
  },
  review_ready: {
    label: "Posts to review",
    description: "Autopilot drafted posts that are waiting for your approval.",
    level: "info",
    defaultOn: true,
  },
};

export interface NotifyPrefs {
  types: Record<string, boolean>;
  email: boolean;
}

const PREF_KEY = (t: string) => `notify.type.${t}`;
const EMAIL_PREF_KEY = "notify.email";

export async function getNotifyPrefs(): Promise<NotifyPrefs> {
  const types: Record<string, boolean> = {};
  for (const [key, def] of Object.entries(NOTIFY_TYPES)) {
    const v = await getSetting(PREF_KEY(key));
    types[key] = v == null ? def.defaultOn : v === "on";
  }
  // Email defaults off and is only meaningful when SMTP is configured.
  const email = (await getSetting(EMAIL_PREF_KEY)) === "on";
  return { types, email };
}

export async function setNotifyPrefs(patch: { types?: Record<string, boolean>; email?: boolean }): Promise<void> {
  if (patch.types) {
    for (const [key, on] of Object.entries(patch.types)) {
      if (NOTIFY_TYPES[key]) await setSetting(PREF_KEY(key), on ? "on" : "off");
    }
  }
  if (typeof patch.email === "boolean") await setSetting(EMAIL_PREF_KEY, patch.email ? "on" : "off");
}

export interface NotifyInput {
  type: keyof typeof NOTIFY_TYPES | string;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

/** Record a notification for the operator, respecting their per-type toggle,
 * and mirror to email when enabled + configured. Safe: swallows its own errors. */
export async function notify(userId: string, input: NotifyInput): Promise<void> {
  try {
    const def = NOTIFY_TYPES[input.type];
    const prefs = await getNotifyPrefs();
    // A disabled type is suppressed entirely (the event is still visible in its
    // own surface, e.g. the dashboard "Needs attention" list).
    if (def && prefs.types[input.type] === false) return;

    const created = await db.notification.create({
      data: {
        userId,
        type: input.type,
        level: def?.level ?? "info",
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        link: input.link ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    if (prefs.email && emailConfigured()) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        const res = await sendEmail(user.email, `[QANTM] ${input.title}`, `${input.body}\n\n— QANTM Media Portal`);
        if (res.sent) await db.notification.update({ where: { id: created.id }, data: { emailedAt: new Date() } });
      }
    }
  } catch (err) {
    console.error("notify failed", input.type, err);
  }
}

export interface NotificationView {
  id: string;
  type: string;
  level: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  emailed: boolean;
  createdAt: string;
}

function shape(n: {
  id: string;
  type: string;
  level: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  emailedAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: n.id,
    type: n.type,
    level: n.level,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.read,
    emailed: n.emailedAt != null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(userId: string, limit = 30): Promise<{ notifications: NotificationView[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit }),
    db.notification.count({ where: { userId, read: false } }),
  ]);
  return { notifications: rows.map(shape), unread };
}

/** Mark one notification (by id) or all of the operator's notifications read. */
export async function markRead(userId: string, opts: { id?: string; all?: boolean }): Promise<number> {
  if (opts.all) {
    const res = await db.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return res.count;
  }
  if (opts.id) {
    const res = await db.notification.updateMany({ where: { id: opts.id, userId }, data: { read: true } });
    return res.count;
  }
  return 0;
}
