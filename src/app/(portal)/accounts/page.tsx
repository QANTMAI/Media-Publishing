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
  {
    mark: "YT",
    name: "YouTube",
    handle: "upload videos to your channel",
    scopes: OAUTH_SCOPES.YT,
    start: "/api/oauth/youtube/start",
  },
] satisfies OauthTarget[];

function startUrlFor(platform: string): string | null {
  if (META_PLATFORMS.includes(platform)) return "/api/oauth/meta/start";
  if (platform === "linkedin") return "/api/oauth/linkedin/start";
  if (platform === "youtube") return "/api/oauth/youtube/start";
  return null;
}

export default function AccountsPage() {
  const { accounts, setAccounts, notify } = usePortal();
  const [loaded, setLoaded] = useState(false);
  const [oauthTarget, setOauthTarget] = useState<OauthTarget | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [removeAcct, setRemoveAcct] = useState<SocialAccount | null>(null);
  const [removing, setRemoving] = useState(false);
  // Bluesky connects with an app password (no OAuth) — its own small form.
  const [blueskyOpen, setBlueskyOpen] = useState(false);
  const [bsHandle, setBsHandle] = useState("");
  const [bsPassword, setBsPassword] = useState("");
  const [bsBusy, setBsBusy] = useState(false);
  const [bsError, setBsError] = useState("");
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [setup, setSetup] = useState<
    { platform: string; name: string; console: string; steps: string[]; note?: string; redirectUri: string } | null
  >(null);
  const [setupId, setSetupId] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupErr, setSetupErr] = useState("");

  const openSetup = async (platform: string, name: string) => {
    setSetupErr("");
    setSetupId("");
    setSetupSecret("");
    const res = await fetch(`/api/oauth/config?platform=${platform}`);
    if (!res.ok) return notify("Couldn't open setup");
    const d = await res.json();
    setSetup({ platform, name, console: d.guide.console, steps: d.guide.steps, note: d.guide.note, redirectUri: d.redirectUri });
  };

  const saveSetup = async () => {
    if (!setup) return;
    if (!setupId.trim() || !setupSecret.trim()) return setSetupErr("Enter both the Client ID and Client Secret");
    setSetupBusy(true);
    setSetupErr("");
    let res: Response;
    try {
      res = await fetch("/api/oauth/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: setup.platform, clientId: setupId, clientSecret: setupSecret }),
      });
    } catch {
      setSetupBusy(false);
      return setSetupErr("Couldn't reach the server");
    }
    setSetupBusy(false);
    if (res.ok) {
      const name = setup.name;
      setSetup(null);
      notify(`${name} configured — you can Connect now`);
      refresh();
    } else {
      setSetupErr((await res.json().catch(() => ({}))).error ?? "Save failed");
    }
  };

  const refresh = async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const d = await res.json();
      setAccounts(d.accounts);
      setConfigured(d.configured ?? {});
    }
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
        if (res.ok) {
          const d = await res.json();
          setAccounts(d.accounts);
          setConfigured(d.configured ?? {});
        }
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
    if (connectError) {
      notify(
        connectError === "not_configured"
          ? "That platform isn't set up yet — add its OAuth credentials (docs/DEPLOYMENT.md) to connect for real."
          : connectError,
      );
    }
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

  const connectBluesky = async () => {
    setBsBusy(true);
    setBsError("");
    let res: Response;
    try {
      res = await fetch("/api/accounts/connect/bluesky", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: bsHandle, appPassword: bsPassword }),
      });
    } catch {
      setBsBusy(false);
      setBsError("Couldn't reach the server. Is the app still running?");
      return;
    }
    setBsBusy(false);
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      notify(`Connected ${d.account?.handle ?? "Bluesky"}`);
      setBlueskyOpen(false);
      setBsHandle("");
      setBsPassword("");
      setBsError("");
      refresh();
    } else {
      // Keep the reason visible in the dialog — a toast alone reads as
      // "nothing happened" when a submit is rejected.
      setBsError(d.error ?? "Could not connect Bluesky");
    }
  };

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
        {CONNECTABLE.map((p) => {
          const cfg = p.start.includes("meta") ? "meta" : p.start.includes("linkedin") ? "linkedin" : "youtube";
          const isConfigured = configured[cfg] ?? false;
          return (
            <div key={p.mark} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
              <div className="mark">{p.mark}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
                  {p.handle}
                  {!isConfigured && " · needs OAuth setup (docs/DEPLOYMENT.md)"}
                </div>
              </div>
              {isConfigured ? (
                <button className="btn btn-primary" onClick={() => setOauthTarget(p)}>
                  Connect
                </button>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={() => openSetup(cfg, p.name)}
                  title="Set up this platform's OAuth app credentials to connect for real."
                >
                  Set up
                </button>
              )}
            </div>
          );
        })}
        {/* Bluesky — app password, not OAuth. No developer app, no app review. */}
        <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
          <div className="mark">BS</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Bluesky</div>
            <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
              app password — no developer app needed, post for real today
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setBlueskyOpen(true)}>
            Connect
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 10 }}>
        X, TikTok, Threads, Pinterest and Google Business arrive in the next
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

      {/* ── Bluesky connect (app password) ── */}
      {blueskyOpen && (
        <div
          className="dialog-backdrop"
          onClick={() => {
            if (!bsBusy) {
              setBlueskyOpen(false);
              setBsError("");
            }
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div className="mark">BS</div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 16 }}>Connect Bluesky</div>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--color-neutral-700)" }}>
                Bluesky uses an <strong>app password</strong> — not OAuth. Create one at{" "}
                <strong>Bluesky → Settings → App Passwords</strong> and paste it below. It&apos;s stored
                encrypted in the vault and can be revoked in Bluesky anytime, independently of your main
                password.
              </p>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Handle</label>
              <input
                className="input"
                value={bsHandle}
                placeholder="you.bsky.social"
                onChange={(e) => setBsHandle(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{ width: "100%", marginBottom: 12 }}
              />
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>App password</label>
              <input
                className="input"
                type="password"
                value={bsPassword}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                onChange={(e) => setBsPassword(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => e.key === "Enter" && bsHandle.trim() && bsPassword.trim() && !bsBusy && connectBluesky()}
                style={{ width: "100%" }}
              />
              {bsError && (
                <p
                  role="alert"
                  style={{
                    margin: "12px 0 0",
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--color-accent-2-100, #fde8e8)",
                    color: "var(--color-accent-2-700, #a12525)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    lineHeight: 1.4,
                  }}
                >
                  {bsError}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 20px", borderTop: "2px solid var(--color-divider)" }}>
              <button
                className="btn btn-primary"
                onClick={connectBluesky}
                disabled={bsBusy || !bsHandle.trim() || !bsPassword.trim()}
              >
                {bsBusy ? "Connecting…" : "Connect"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setBlueskyOpen(false);
                  setBsError("");
                }}
                disabled={bsBusy}
              >
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

      {/* ── OAuth app setup (enter Client ID/Secret, no .env editing) ── */}
      {setup && (
        <div className="dialog-backdrop" onClick={() => !setupBusy && setSetup(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "2px solid var(--color-text)" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 16 }}>Set up {setup.name}</div>
            </div>
            <div style={{ padding: 20, maxHeight: "60vh", overflowY: "auto" }}>
              <ol style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5, color: "var(--color-neutral-700)", lineHeight: 1.5 }}>
                {setup.steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{s}</li>
                ))}
              </ol>
              <a href={setup.console} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--color-accent-700)" }}>
                Open the developer console →
              </a>
              <div style={{ margin: "12px 0", padding: "8px 10px", borderRadius: 8, background: "var(--color-neutral-100)", fontSize: 11.5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600 }}>Register this redirect URI — it must match EXACTLY:</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "2px 8px", flex: "none" }}
                    onClick={() => {
                      navigator.clipboard?.writeText(setup.redirectUri).then(
                        () => notify("Redirect URI copied"),
                        () => notify("Copy failed — select it manually"),
                      );
                    }}
                  >
                    Copy
                  </button>
                </div>
                <code style={{ wordBreak: "break-all" }}>{setup.redirectUri}</code>
              </div>
              {(setup.platform === "linkedin" || setup.platform === "meta") && setup.redirectUri.startsWith("http://") && (
                <p style={{ fontSize: 11.5, color: "var(--color-accent-2-700)", fontWeight: 600, margin: "0 0 12px", padding: "8px 10px", borderRadius: 8, background: "var(--color-accent-2-50, #fdeaea)" }}>
                  ⚠ {setup.name} requires an <b>https</b> address — it rejects <code>http://localhost</code> and the sign-in will never redirect back here. Connect {setup.name} after deploying (register the <code>https://…</code> callback there instead). Bluesky and YouTube work locally.
                </p>
              )}
              {setup.note && (
                <p style={{ fontSize: 11.5, color: "var(--color-accent-2-700)", margin: "0 0 12px" }}>⚠ {setup.note}</p>
              )}
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Client ID</label>
              <input className="input" value={setupId} onChange={(e) => setSetupId(e.target.value)} spellCheck={false} style={{ width: "100%", marginBottom: 12 }} />
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Client Secret</label>
              <input className="input" type="password" value={setupSecret} onChange={(e) => setSetupSecret(e.target.value)} autoComplete="off" spellCheck={false} style={{ width: "100%" }} />
              {setupErr && <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "12px 0 0" }}>{setupErr}</p>}
            </div>
            <div style={{ display: "flex", gap: 10, padding: "16px 20px", borderTop: "2px solid var(--color-divider)" }}>
              <button className="btn btn-primary" onClick={saveSetup} disabled={setupBusy}>
                {setupBusy ? "Saving…" : "Save & enable"}
              </button>
              <button className="btn btn-secondary" onClick={() => setSetup(null)} disabled={setupBusy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
