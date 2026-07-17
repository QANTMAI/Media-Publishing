"use client";

import { useEffect, useState } from "react";
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

// Scopes each platform's OAuth grant requests — shown in the consent modal so
// the operator sees exactly what they're authorizing before the redirect.
const OAUTH_SCOPES: Record<string, string[]> = {
  IG: [
    "Publish posts, Reels & Stories to your feed",
    "Read post insights & engagement metrics",
    "Access your linked Facebook Page",
  ],
  FB: ["Publish posts, photos and video to your Page", "Read Page insights", "Manage Page content"],
  TH: ["Publish posts to your Threads profile", "Read post engagement"],
  X: ["Post on your behalf", "Read your posts and engagement metrics"],
  IN: ["Create posts as you or your organisation", "Read your basic profile"],
  YT: ["Upload and manage videos", "Set titles, descriptions & thumbnails", "Read channel analytics"],
  TT: ["Publish videos to your account", "Read video performance stats"],
  BS: ["Post on your behalf", "Read your posts"],
  PN: ["Create Pins on your boards", "Read Pin analytics"],
  GB: ["Post updates to your business profile", "Read post insights"],
};

export default function AccountsPage() {
  const { accounts, setAccounts, notify } = usePortal();
  const [loaded, setLoaded] = useState(false);
  const [oauthAccount, setOauthAccount] = useState<SocialAccount | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const refresh = async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts((await res.json()).accounts);
    setLoaded(true);
  };

  // Surface the OAuth callback result (?connected= / ?connect_error=) once.
  // Own fetch on mount (state set in the resolved continuation) — the page
  // must distinguish "loading" from "genuinely no accounts".
  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts")
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) setAccounts((await res.json()).accounts);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Connect/Reconnect open the consent modal first (shows scopes), then the
  // real OAuth redirect happens on Authorize.
  const connect = (a: SocialAccount) => setOauthAccount(a);

  const authorize = () => {
    const a = oauthAccount;
    if (!a) return;
    if (META_PLATFORMS.includes(a.platform)) {
      setRedirecting(true);
      // Full-page navigation into the real (or mock) OAuth flow.
      window.location.assign("/api/oauth/meta/start");
    } else {
      setOauthAccount(null);
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
            {loaded ? "No accounts yet — connecting Meta creates your first rows." : "Loading accounts…"}
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

      {/* ── OAuth consent modal ── */}
      {oauthAccount && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!redirecting) setOauthAccount(null);
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div className="mark">{oauthAccount.mark}</div>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 16 }}>
                  Connect {oauthAccount.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{oauthAccount.handle}</div>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              {redirecting ? (
                <p style={{ margin: 0, fontSize: 14, color: "var(--color-neutral-700)" }}>
                  Redirecting to {oauthAccount.name}&apos;s secure sign-in…
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-neutral-700)" }}>
                    <strong style={{ color: "var(--color-accent-700)" }}>OAuth 2.0</strong> · you sign in on{" "}
                    {oauthAccount.name}&apos;s own page — your password is never shared with this portal. This
                    grant will request:
                  </p>
                  <ul style={{ margin: "0 0 4px", paddingLeft: 18, fontSize: 13, color: "var(--color-neutral-800)" }}>
                    {(OAUTH_SCOPES[oauthAccount.mark] ?? ["Publish on your behalf", "Read engagement metrics"]).map(
                      (scope) => (
                        <li key={scope} style={{ marginBottom: 4 }}>
                          {scope}
                        </li>
                      ),
                    )}
                  </ul>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-neutral-600)" }}>
                    On approval the token is stored encrypted in the vault — never in your browser.
                  </p>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 20px", borderTop: "2px solid var(--color-divider)" }}>
              <button className="btn btn-primary" onClick={authorize} disabled={redirecting}>
                {redirecting ? "Redirecting…" : `Authorize ${oauthAccount.name}`}
              </button>
              <button className="btn btn-secondary" onClick={() => setOauthAccount(null)} disabled={redirecting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
