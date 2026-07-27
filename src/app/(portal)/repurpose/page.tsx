"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { usePortal } from "@/lib/store";
import { PLATFORM_RULES } from "@/lib/platforms";

/* AI-2 — one-canvas repurposing. Paste one piece of content, pick channels,
 * and generate per-platform drafts in your brand voice (AI-1). Results are
 * saved as a DRAFT post — you approve them on the Dashboard before anything
 * publishes. Gated on your Anthropic key; honest no-op states throughout. */

interface ResultChannel {
  platform: string;
  accountId: string;
  caption: string;
  overLimit: boolean;
}

export default function RepurposePage() {
  const notify = usePortal((s) => s.notify);
  const accounts = usePortal((s) => s.accounts);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ channels: ResultChannel[]; warnings: string[] } | null>(null);

  // Publishable = the platform has adaptation rules (a PLATFORM_RULES entry).
  const connectable = accounts.filter((a) => a.status === "connected" && !!PLATFORM_RULES[a.platform]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const generate = async () => {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/repurpose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, accountIds: [...selected] }),
    });
    setBusy(false);
    const d = await res.json().catch(() => ({}));
    if (d.ok) {
      setResult({ channels: d.channels, warnings: d.warnings ?? [] });
      notify(`Repurposed into ${d.channels.length} draft${d.channels.length === 1 ? "" : "s"} — review & approve on your Dashboard`);
    } else if (d.reason === "no_anthropic_key") {
      notify("Add your Anthropic key in Settings → Integrations & keys to repurpose");
    } else if (d.reason === "no_source") {
      notify("Paste the content you want to repurpose first");
    } else if (d.reason === "no_channels") {
      notify("Select at least one connected channel");
    } else if (d.reason === "rate_limited") {
      notify("You're repurposing too often — try again shortly");
    } else if (d.reason === "api_error") {
      notify(`Repurpose failed: ${d.status ?? "provider error"}`);
    } else notify("Could not repurpose");
  };

  return (
    <div style={{ maxWidth: "80ch" }}>
      <p className="kick">One-canvas repurposing</p>
      <div className="stack stack-strong" style={{ padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginBottom: 12 }}>
          Paste one piece of content and pick channels. Each platform gets a native draft in your{" "}
          <strong>brand voice</strong> — grounded only in what you write here (no invented facts). Results are saved as a
          draft; you approve them on your Dashboard before anything publishes.
        </div>
        <textarea
          className="input"
          value={source}
          placeholder="Paste the post, article, transcript, or idea you want to repurpose…"
          onChange={(e) => setSource(e.target.value)}
          rows={7}
          style={{ width: "100%", marginBottom: 14, resize: "vertical" }}
        />
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Channels</div>
        {connectable.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--color-neutral-600)", marginBottom: 12 }}>
            No connected publishable accounts yet — connect one under Accounts.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {connectable.map((a) => {
              const on = selected.has(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer",
                    borderRadius: 10, font: "inherit", fontSize: 13,
                    border: on ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                    background: on ? "var(--color-accent-100)" : "var(--color-bg)",
                  }}
                >
                  <span className="mark" style={{ width: 22, height: 22, fontSize: 10 }}>{a.mark}</span>
                  {a.name} <span style={{ color: "var(--color-neutral-500)" }}>{a.handle}</span>
                </button>
              );
            })}
          </div>
        )}
        <button className="btn btn-primary" onClick={generate} disabled={busy || !source.trim() || selected.size === 0}>
          <Sparkles size={15} /> {busy ? "Repurposing…" : "Repurpose"}
        </button>
      </div>

      {result && (
        <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15 }}>Draft created · {result.channels.length} channels</div>
            <a href="/dashboard" className="btn btn-secondary" style={{ fontSize: 12 }}>Review &amp; approve →</a>
          </div>
          {result.warnings.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--color-accent-2-700)", marginBottom: 10 }}>
              {result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {result.channels.map((c) => {
              const limit = PLATFORM_RULES[c.platform]?.limit ?? 0;
              return (
                <div key={c.accountId} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--color-divider)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="tag" style={{ fontSize: 10 }}>{PLATFORM_RULES[c.platform]?.name ?? c.platform}</span>
                    <span style={{ fontSize: 11, color: c.overLimit ? "var(--color-accent-2-700)" : "var(--color-neutral-500)" }}>
                      {c.caption.length}{limit ? `/${limit}` : ""}{c.overLimit ? " · over limit — trim before approving" : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-neutral-800)", whiteSpace: "pre-wrap" }}>{c.caption}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-neutral-600)", marginTop: 12 }}>
            Saved as a draft. Approve or discard each on your <a href="/dashboard">Dashboard</a> — nothing publishes until you approve.
          </div>
        </div>
      )}
    </div>
  );
}
