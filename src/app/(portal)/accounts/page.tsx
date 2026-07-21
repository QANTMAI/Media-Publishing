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
  // Real scopes requested by /api/oauth/linkedin/start: openid profile w_member_social.
  IN: ["Post on LinkedIn on your behalf (w_member_social)", "Verify your identity & name (openid, profile)"],
  YT: ["Upload and manage videos", "Set titles, descriptions & thumbnails", "Read channel analytics"],
  TT: ["Publish videos to your account", "Read video performance stats"],
  BS: ["Post on your behalf", "Read your posts"],
  PN: ["Create Pins on your boards", "Read Pin analytics"],
  GB: ["Post updates to your business profile", "Read post insights"],
};

/** What the consent modal authorizes — either an existing account row or a
 * platform-level connect (needed when the list is empty). */
interface OauthTarget {
  mark: string;
  name: string;
  handle: string;
  scopes: string[];
  /** The real OAuth start route; null = integration not built yet. */
  start: string | null;
}

/** Platforms connectable today, shown in the "Connect a platform" panel.
 * Meta discovery creates one row per granted Page/IG account; LinkedIn
 * creates the member's row. Others arrive wave by wave. */
const CONNECTABLE = [
  {
    mark: "IG",
    name: "Instagram + Facebook",
    handle: "via Meta — one grant covers your Pages & IG business accounts",
    scopes: [...OAUTH_SCOPES.IG, ...OAUTH_SCOPES.FB],
    start: "/api/oauth/meta/start",
  },
  {
    mark: "IN",
    name: "LinkedIn",
    handle: "post to your member profile",
    scopes: OAUTH_SCOPES.IN,
    start: "/api/oauth/linkedin/start",
  },
] satisfies OauthTarget[];

function startUrlFor(platform: string): string | null {
  if (META_PLATFORMS.includes(platform)) return "/api/oauth/meta/start";
  if (platform === "linkedin") return "/api/oauth/linkedin/start";
  return null;
}

export default function AccountsPage() {
  const { accounts, setAccounts, notify } = usePortal();
  const [loaded, setLoaded] = useState(false);
  const [oauthTarget, setOauthTarget] = useState<OauthTarget | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [removeAcct, setRemoveAcct] = useState<SocialAccount | null>(null);
  const [removing, setRemoving] = useState(false);

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

  /** Remove = irreversible purge (row + its posts). Confirmed via dialog. */
  const removeConfirmed = async () => {
    const a = removeAcct;
    if (!a) return;
    setRemoving(true);
    const res = await fetch(`/api/accounts/${a.id}?purge=1`, { method: "DELETE" });
    setRemoving(false);
    setRemoveAcct(null);
    if (res.ok) {
      const d = await res.json();
      notify(
        `${a.handle} removed${d.removedTargets ? ` · ${d.removedTargets} post${d.removedTargets === 1 ? "" : "s"} deleted` : ""}`,
      );
    } else {
      notify("Remove failed");
    }
    refresh();
  };

  // Connect/Reconnect open the consent modal first (shows scopes), then the
  // real OAuth redirect happens on Authorize.
  const connect = (a: SocialAccount) =>
    setOauthTarget({
      mark: a.mark,
      name: a.name,
      handle: a.handle,
      scopes: OAUTH_SCOPES[a.mark] ?? ["Publish on your behalf", "Read engagement metrics"],
      start: startUrlFor(a.platform),
    });

  const authorize = () => {
    const t = oauthTarget;
    if (!t) return;
    if (t.start) {
      setRedirecting(true);
      // Full-page navigation into the real (or mock) OAuth flow.
      window.location.assign(t.start);
    } else {
      setOauthTarget(null);
      notify(`${t.name} connect ships with its platform app (Waves 2–3) — Meta & LinkedIn first`);
    }
  };

  const actionsFor = (a: SocialAccount) => {
    const disconnectAction = { label: "Disconnect", cls: "btn btn-ghost", on: () => disconnect(a) };
    // Remove is available on EVERY row — it's the only way to delete an
    // account (and its posts) from the portal entirely.
    const removeAction = { label: "Remove", cls: "btn btn-ghost", on: () => setRemoveAcct(a) };
    switch (a.status) {
      case "disconnected":
        return [{ label: "Connect", cls: "btn btn-primary", on: () => connect(a) }, removeAction];
      case "paused":
        return [
          { label: "Resume", cls: "btn btn-secondary", on: () => patchStatus(a, "connected", `${a.name} resumed`) },
          disconnectAction,
          removeAction,
        ];
      case "expiring":
        return [
          { label: "Reconnect", cls: "btn btn-primary", on: () => connect(a) },
          disconnectAction,
          removeAction,
        ];
      default:
        return [
          { label: "Pause", cls: "btn btn-secondary", on: () => patchStatus(a, "paused", `${a.name} paused — posts held`) },
          disconnectAction,
          removeAction,
        ];
    }
  };

  return (
    <div>
      <p className="kick">Connected accounts · OAuth · tokens held in encrypted vault</p>
      <div className="stack stack-strong">
        {accounts.length === 0 && (
          <div style={{ padding: "18px", fontSize: 13, color: "var(--color-neutral-600)" }}>
            {loaded ? "No accounts yet — connect a platform below to create your first rows." : "Loading accounts…"}
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
        Disconnect deletes the stored token from the vault, cutting the portal&apos;s access. Where the
        platform documents a revoke endpoint (Meta) we call it too; elsewhere (LinkedIn) the grant
        itself expires per the platform&apos;s token lifetime or when you remove the app in its settings.
      </p>

      {/* ── Connect a platform (works from an empty list) ── */}
      <p className="kick" style={{ marginTop: 26 }}>
        Connect a platform
      </p>
      <div className="stack stack-strong">
        {CONNECTABLE.map((p) => (
          <div key={p.mark} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
            <div className="mark">{p.mark}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{p.handle}</div>
            </div>
            <button className="btn btn-primary" onClick={() => setOauthTarget(p)}>
              Connect
            </button>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 10 }}>
        X, YouTube, TikTok, Threads, Bluesky, Pinterest and Google Business arrive in the next
        integration waves.
      </p>

      {/* ── Remove (purge) confirmation ── */}
      {removeAcct && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!removing) setRemoveAcct(null);
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div className="mark">{removeAcct.mark}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 16 }}>
                Remove {removeAcct.name}?
              </div>
            </div>
            <div style={{ padding: 20, fontSize: 13.5, color: "var(--color-neutral-800)" }}>
              <p style={{ margin: "0 0 10px" }}>
                <strong>{removeAcct.handle}</strong>
                {removeAcct.label ? ` (${removeAcct.label})` : ""} will be deleted from the portal
                {removeAcct.postCount ? (
                  <>
                    {" "}
                    <strong style={{ color: "var(--color-accent-2-700)" }}>
                      along with its {removeAcct.postCount} post{removeAcct.postCount === 1 ? "" : "s"}
                    </strong>{" "}
                    (scheduled and published history)
                  </>
                ) : (
                  <> — it has no posts</>
                )}
                . Any stored token is wiped from the vault.
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-neutral-600)" }}>
                This can&apos;t be undone. Posts already live on the platform itself are not affected.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 20px", borderTop: "2px solid var(--color-divider)" }}>
              <button className="btn btn-primary" onClick={removeConfirmed} disabled={removing}>
                {removing ? "Removing…" : "Remove account"}
              </button>
              <button className="btn btn-secondary" onClick={() => setRemoveAcct(null)} disabled={removing}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OAuth consent modal ── */}
      {oauthTarget && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!redirecting) setOauthTarget(null);
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div className="mark">{oauthTarget.mark}</div>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 16 }}>
                  Connect {oauthTarget.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{oauthTarget.handle}</div>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              {redirecting ? (
                <p style={{ margin: 0, fontSize: 14, color: "var(--color-neutral-700)" }}>
                  Redirecting to {oauthTarget.name}&apos;s secure sign-in…
                </p>
              ) : (
                <>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-neutral-700)" }}>
                    <strong style={{ color: "var(--color-accent-700)" }}>OAuth 2.0</strong> · you sign in on{" "}
                    {oauthTarget.name}&apos;s own page — your password is never shared with this portal. This
                    grant will request:
                  </p>
                  <ul style={{ margin: "0 0 4px", paddingLeft: 18, fontSize: 13, color: "var(--color-neutral-800)" }}>
                    {oauthTarget.scopes.map((scope) => (
                      <li key={scope} style={{ marginBottom: 4 }}>
                        {scope}
                      </li>
                    ))}
                  </ul>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-neutral-600)" }}>
                    On approval the token is stored encrypted in the vault — never in your browser.
                  </p>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 20px", borderTop: "2px solid var(--color-divider)" }}>
              <button className="btn btn-primary" onClick={authorize} disabled={redirecting}>
                {redirecting ? "Redirecting…" : `Authorize ${oauthTarget.name}`}
              </button>
              <button className="btn btn-secondary" onClick={() => setOauthTarget(null)} disabled={redirecting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
