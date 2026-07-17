"use client";

/* Standalone DEV-ONLY sign-in — password only, no 2FA. Backed by
 * /api/auth/dev-login, which returns 404 unless AUTH_DEV_BYPASS=1 and
 * NODE_ENV != production. Fully self-contained: to remove dev access later,
 * delete this file, the /api/auth/dev-login route, and the AUTH_DEV_BYPASS
 * env var. The real /login (email + password + TOTP) is untouched. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthPoster } from "@/components/AuthPoster";

export default function DevLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("info@qantm.ai");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/dashboard");
        return;
      }
      if (res.status === 404) {
        setError("Dev sign-in is disabled (set AUTH_DEV_BYPASS=1 in .env).");
      } else {
        setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed");
      }
    } catch {
      setError("Network error — is the dev server running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <AuthPoster />
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          background: "var(--color-bg)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 360 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <p className="kick">Developer sign-in</p>
            <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>Local access</h2>
            <div
              style={{
                background: "#fff6e6",
                border: "1px solid #ffd77f",
                borderRadius: 12,
                padding: "10px 14px",
                margin: "0 0 20px",
                fontSize: 12.5,
                color: "#9c6700",
              }}
            >
              <strong>Dev only</strong> — password, no 2FA. This never works in production; the real
              sign-in with your authenticator is at{" "}
              <a href="/login" style={{ color: "#9c6700", textDecoration: "underline" }}>
                /login
              </a>
              .
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ marginBottom: 18 }}>
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && (
              <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Checking…" : "Sign in (dev)"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
