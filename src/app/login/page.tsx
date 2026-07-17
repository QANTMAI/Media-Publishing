"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePortal } from "@/lib/store";
import { Toast } from "@/components/Toast";
import { AuthPoster } from "@/components/AuthPoster";

export default function LoginPage() {
  const router = useRouter();
  const notify = usePortal((s) => s.notify);
  const [stage, setStage] = useState<"login" | "2fa">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Already signed in → straight to the app; brand-new install → setup.
    fetch("/api/auth/me").then((r) => {
      if (r.ok) router.replace("/dashboard");
    });
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.needsSetup) router.replace("/setup");
      })
      .catch(() => {});
  }, [router]);

  const submitLogin = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      setStage("2fa");
    } else {
      setError((await res.json()).error ?? "Sign-in failed");
    }
  };

  const submitVerify = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (res.ok) {
      notify("Signed in securely");
      router.replace("/dashboard");
    } else {
      setError((await res.json()).error ?? "Verification failed");
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
          {stage === "login" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitLogin();
              }}
            >
              <p className="kick">Secure sign-in</p>
              <h2 style={{ fontSize: 28, margin: "0 0 22px" }}>Sign in to your portal</h2>
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
              <div className="field" style={{ marginBottom: 8 }}>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div style={{ textAlign: "right", marginBottom: 18 }}>
                <span style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>
                  Lost access? See docs/DEVELOPMENT.md · Recovery
                </span>
              </div>
              {error && (
                <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                  {error}
                </p>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? "Checking…" : "Continue"}
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-neutral-600)",
                  marginTop: 20,
                  borderTop: "2px solid var(--color-divider)",
                  paddingTop: 12,
                }}
              >
                Sign-in is email + password + authenticator code. SSO and passkeys are on the
                roadmap, not available yet.
              </p>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitVerify();
              }}
            >
              <p className="kick">Two-factor authentication</p>
              <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>Enter your code</h2>
              <p style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: 20 }}>
                Open your authenticator app and enter the 6-digit code for{" "}
                <strong>QANTM Media</strong>.
              </p>
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-label="6-digit authentication code"
                autoFocus
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: 26,
                  letterSpacing: "0.4em",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              />
              {error && (
                <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                  {error}
                </p>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Verifying…" : "Verify & sign in"}
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setStage("login");
                    setError("");
                  }}
                  style={{ paddingLeft: 0 }}
                >
                  Back
                </button>
              </div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-neutral-600)",
                  marginTop: 20,
                  borderTop: "2px solid var(--color-divider)",
                  paddingTop: 12,
                }}
              >
                Codes rotate every 30 seconds in your authenticator app — no resend needed.
              </p>
            </form>
          )}
        </div>
      </div>
      <Toast />
    </div>
  );
}
