"use client";

/* First-run operator setup: create the single account, then enroll mandatory
 * TOTP 2FA by scanning a QR (or entering the key manually) and confirming a
 * live code. Only reachable while no user exists. */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthPoster } from "@/components/AuthPoster";

export default function SetupPage() {
  const router = useRouter();
  const [stage, setStage] = useState<"account" | "totp" | "done">("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [qr, setQr] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.needsSetup) router.replace("/login");
      })
      .catch(() => {});
  }, [router]);

  const createAccount = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setQr(data.qrDataUrl);
      setManualKey(data.manualKey);
      setStage("totp");
    } else {
      setError(data.error ?? "Setup failed");
    }
  };

  const confirmTotp = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/setup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (res.ok) {
      setStage("done");
    } else {
      setError((await res.json()).error ?? "Confirmation failed");
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
        <div style={{ width: "100%", maxWidth: 380 }}>
          {stage === "account" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createAccount();
              }}
            >
              <p className="kick">First-run setup · 1 of 2</p>
              <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>Create your operator account</h2>
              <p style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: 20 }}>
                This portal has a single operator. Two-factor authentication is
                mandatory and is enrolled in the next step.
              </p>
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
                <label htmlFor="password">Password (min 10 characters)</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                  {error}
                </p>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? "Creating…" : "Continue to 2FA"}
              </button>
            </form>
          )}

          {stage === "totp" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirmTotp();
              }}
            >
              <p className="kick">First-run setup · 2 of 2</p>
              <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>Enroll two-factor</h2>
              <p style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: 16 }}>
                Scan with your authenticator app (1Password, Google
                Authenticator, Authy…), then enter the current code.
              </p>
              {qr && (
                <div style={{ border: "2px solid var(--color-text)", padding: 10, width: 244, margin: "0 auto 12px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="TOTP enrollment QR code" width={220} height={220} style={{ display: "block" }} />
                </div>
              )}
              <p
                style={{
                  fontSize: 11,
                  color: "var(--color-neutral-600)",
                  wordBreak: "break-all",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Can&apos;t scan? Key: <strong>{manualKey}</strong>
              </p>
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-label="6-digit authentication code"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: 26,
                  letterSpacing: "0.4em",
                  textAlign: "center",
                  marginBottom: 14,
                }}
              />
              {error && (
                <p style={{ color: "var(--color-accent-2-700)", fontSize: 13, fontWeight: 600, margin: "0 0 12px" }}>
                  {error}
                </p>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Confirm & finish"}
              </button>
            </form>
          )}

          {stage === "done" && (
            <div>
              <p className="kick">Setup complete</p>
              <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>You&apos;re locked down</h2>
              <p style={{ fontSize: 14, color: "var(--color-neutral-700)", marginBottom: 20 }}>
                Account created and 2FA enrolled. Sign in to open your portal.
              </p>
              <button className="btn btn-primary btn-block" onClick={() => router.replace("/login")}>
                Go to sign-in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
