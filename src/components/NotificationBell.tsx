"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { usePortal } from "@/lib/store";

const LEVEL_COLOR: Record<string, string> = {
  error: "#ec3013",
  warn: "#c9781f",
  info: "var(--color-accent)",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const { notifications, unread, refreshNotifications, markNotification, markAllNotificationsRead } = usePortal();
  const [open, setOpen] = useState(false);

  // Poll so a background publish failure surfaces without a manual reload.
  useEffect(() => {
    refreshNotifications();
    const t = setInterval(refreshNotifications, 45_000);
    return () => clearInterval(t);
  }, [refreshNotifications]);

  const openItem = (id: string, link: string | null) => {
    markNotification(id);
    setOpen(false);
    if (link) router.push(link);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn btn-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        title="Notifications"
        style={{ position: "relative", padding: "8px 10px" }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              padding: "0 4px",
              borderRadius: 999,
              background: "var(--color-accent-2)",
              color: "#201e1d",
              fontSize: 11,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--color-bg)",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 31,
              width: 360,
              maxHeight: 440,
              display: "flex",
              flexDirection: "column",
              border: "2px solid var(--color-text)",
              background: "var(--color-bg)",
              boxShadow: "var(--shadow-lg)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom: "2px solid var(--color-divider)",
              }}
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 14 }}>
                Notifications
              </span>
              {unread > 0 && (
                <button
                  onClick={() => markAllNotificationsRead()}
                  style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--color-accent-700)", fontWeight: 600 }}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div style={{ overflowY: "auto" }}>
              {notifications.length === 0 ? (
                <div style={{ padding: "22px 16px", fontSize: 13, color: "var(--color-neutral-600)", textAlign: "center" }}>
                  You&apos;re all caught up.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openItem(n.id, n.link)}
                    style={{
                      display: "flex",
                      gap: 10,
                      width: "100%",
                      textAlign: "left",
                      padding: "12px 14px",
                      border: 0,
                      borderBottom: "1px solid var(--color-divider)",
                      background: n.read ? "transparent" : "var(--color-accent-100)",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <span
                      className="dot"
                      style={{ width: 9, height: 9, marginTop: 4, flex: "none", background: LEVEL_COLOR[n.level] ?? LEVEL_COLOR.info }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>{n.title}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--color-neutral-700)", marginTop: 2 }}>{n.body}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-500)", marginTop: 3 }}>
                        {timeAgo(n.createdAt)}
                        {n.emailed ? " · emailed" : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
