"use client";

import { useEffect } from "react";
import { usePortal } from "@/lib/store";
import type { AccountStatus, SocialAccount } from "@/lib/types";

const BADGES: Record<AccountStatus, { label: string; style: React.CSSProperties }> = {
  connected: {
    label: "Connected",
    style: { background: "var(--color-accent-200)", color: "var(--color-accent-700)" },
  },
  expiring: {
    label: "Expiring soon",
    style: { background: "var(--color-neutral-200)", color: "var(--color-neutral-800)" },
  },
  paused: {
    label: "Paused",
    style: { border: "1px solid var(--color-divider)", color: "var(--color-neutral-700)" },
  },
  disconnected: {
    label: "Not connected",
    style: { border: "1px solid var(--color-divider)", color: "var(--color-neutral-700)" },
  },
};

/** Platforms whose Connect goes through the (shared) Meta OAuth app today. */
const META_PLATFORMS = ["instagram", "facebook", "threads"];

export default function AccountsPage() {
  const { accounts, setAccounts, notify } = usePortal();

  const refresh = async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts((await res.json()).accounts);
  };

  // Surface the OAuth callback result (?connected= / ?connect_error=) once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectError = params.get("connect_error");
    if (connected) notify(`Connected ${connected} account${connected === "1" ? "" : "s"} via Meta`);
    if (connectError) notify(connectError);
    if (connected || connectError) {
      window.history.replaceState(null, "", "/accounts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchStatus = async (a: SocialAccount, status: "connected" | "paused", msg: string) => {
    const res = await fetch(`/api/accounts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    notify(res.ok ? msg : (await res.json()).error ?? "Update failed");
    refresh();
  };

  const disconnect = async (a: SocialAccount) => {
    const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
    notify(res.ok ? `${a.name} disconnected · token revoked` : "Disconnect failed");
    refresh();
  };

  const connect = (a: SocialAccount) => {
    if (META_PLATFORMS.includes(a.platform)) {
      window.location.href = "/api/oauth/meta/start";
    } else {
      notify(`${a.name} connect ships with its platform app (Waves 2–3) — Meta first`);
    }
  };

  const actionsFor = (a: SocialAccount) => {
    const disconnectAction = { label: "Disconnect", cls: "btn btn-ghost", on: () => disconnect(a) };
    switch (a.status) {
      case "disconnected":
        return [{ label: "Connect", cls: "btn btn-primary", on: () => connect(a) }];
      case "paused":
        return [
          { label: "Resume", cls: "btn btn-secondary", on: () => patchStatus(a, "connected", `${a.name} resumed`) },
          disconnectAction,
        ];
      case "expiring":
        return [
          { label: "Reconnect", cls: "btn btn-primary", on: () => connect(a) },
          disconnectAction,
        ];
      default:
        return [
          { label: "Pause", cls: "btn btn-secondary", on: () => patchStatus(a, "paused", `${a.name} paused — posts held`) },
          disconnectAction,
        ];
    }
  };

  return (
    <div>
      <p className="kick">Connected accounts · OAuth · tokens held in encrypted vault</p>
      <div className="stack stack-strong">
        {accounts.length === 0 && (
          <div style={{ padding: "18px", fontSize: 13, color: "var(--color-neutral-600)" }}>
            Loading accounts…
          </div>
        )}
        {accounts.map((a) => {
          const badge = BADGES[a.status];
          return (
            <div key={a.id} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div className="mark">{a.mark}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {a.name}
                  {a.label && (
                    <span className="tag tag-outline" style={{ marginLeft: 8, fontSize: 9 }}>
                      {a.label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{a.handle}</div>
              </div>
              <span className="tag" style={{ flex: "none", ...badge.style }}>
                {badge.label}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {actionsFor(a).map((act) => (
                  <button key={act.label} className={act.cls} onClick={act.on}>
                    {act.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 10 }}>
        Disconnect deletes the stored token from the vault and calls the platform&apos;s revoke
        endpoint, cutting access on both ends.
      </p>
    </div>
  );
}
