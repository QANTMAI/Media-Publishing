"use client";

import { useEffect, useState } from "react";
import { usePortal } from "@/lib/store";

/* Settings (handoff #2 §7). Phase A ships the shell + the Autopilot delivery
 * mode (real, persisted). Category management, API-key storage, and
 * notification wiring land in Phase B — shown here honestly as what's coming,
 * not as working controls. */

type Mode = "review" | "auto";

export default function SettingsPage() {
  const notify = usePortal((s) => s.notify);
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings").then(async (res) => {
      if (cancelled || !res.ok) return;
      const d = await res.json();
      setMode(d.autopilotMode === "auto" ? "auto" : "review");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMode = async (next: Mode) => {
    setMode(next);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autopilotMode: next }),
    });
    notify(res.ok ? `Autopilot set to ${next === "auto" ? "auto-schedule" : "review"}` : "Could not save");
  };

  return (
    <div style={{ maxWidth: "72ch", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* ── Autopilot ── */}
      <section>
        <p className="kick" style={{ color: "var(--color-accent)" }}>
          Autopilot
        </p>
        <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            When Autopilot drafts a post…
          </div>
          <div style={{ fontSize: 13, color: "var(--color-neutral-700)", marginBottom: 14 }}>
            Choose how AI-planned posts are delivered.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {([
              { v: "review", title: "Hold for review", body: "Drafts wait in the Dashboard review inbox — you approve each before it schedules." },
              { v: "auto", title: "Auto-schedule", body: "Drafts go straight onto the calendar. No per-post approval." },
            ] as const).map((opt) => {
              const active = mode === opt.v;
              return (
                <button
                  key={opt.v}
                  onClick={() => saveMode(opt.v)}
                  disabled={mode === null}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    textAlign: "left",
                    padding: "12px 14px",
                    cursor: "pointer",
                    borderRadius: 12,
                    border: active ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                    background: active ? "var(--color-accent-100)" : "var(--color-bg)",
                    font: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{opt.title}</div>
                  <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>{opt.body}</div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--color-neutral-600)" }}>
            Trend &amp; news sources (which feeds Autopilot draws from, add-your-own RSS) arrive with the
            optimizer/growth engine.
          </div>
        </div>
      </section>

      {/* ── Categories (Phase B) ── */}
      <PlaceholderCard
        title="Categories"
        lead="Rename, recolor, add, and delete the content categories used by the composer and calendar."
        note="Category management ships in the next phase — today the composer's ＋ New adds categories for your session."
      />

      {/* ── Integrations / keys (Phase B) ── */}
      <section>
        <p className="kick">Integrations &amp; keys</p>
        <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            AI model &amp; platform credentials
          </div>
          <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>
            Bring-your-own AI model keys (OpenAI, Anthropic, …) and platform app keys/secrets. When this lands,
            every secret is stored <strong>encrypted in the vault</strong>, shown masked, and never sent back to
            the browser — consistent with how OAuth tokens are already handled.
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-600)" }}>
            Configured in the next phase.
          </div>
        </div>
      </section>

      {/* ── Notifications (Phase B) ── */}
      <PlaceholderCard
        title="Notifications"
        lead="Choose when the portal alerts you — publish failures, expiring tokens, weekly summaries."
        note="Delivery wiring ships with the observability phase."
      />
    </div>
  );
}

function PlaceholderCard({ title, lead, note }: { title: string; lead: string; note: string }) {
  return (
    <section>
      <p className="kick">{title}</p>
      <div className="stack stack-strong" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>{lead}</div>
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-600)" }}>{note}</div>
      </div>
    </section>
  );
}
